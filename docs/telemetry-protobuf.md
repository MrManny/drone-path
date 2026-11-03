# DJI Neo 2 Telemetry Protobuf (DVTM)

Technical overview of the per-frame telemetry embedded in Neo 2 video files:
where it lives in the container, how to slice it, and what the fields mean.
There is no official spec — this layout is reverse-engineered and was verified
value-by-value against `.SRT` sidecars and photo XMP (see
[Verification](#verification)). Snapshot of knowledge at the time of writing;
treat field numbers as stable and semantics of undecoded fields as open.

## Container

- Every native `DJI_*.MP4` (and `dji_fly` app exports) carries a second stream:
  an MP4 `data` stream with sample-entry fourcc `djmd` and
  `handler_name = "CAM meta"`. Its payload is DJI's internal **DVTM** ("DJI
  Video Metadata") protobuf.
- One sample = one `ProductMeta` message = **one video frame**: sample *i* is
  frame *i* (SRT `FrameCnt` *i*+1).
- Messages are **variable length** (299–563 B on Neo 2) — never assume a fixed
  stride. Read per-packet sizes from ffprobe: they partition the raw dump
  exactly, and `pts_time` is the frame's PTS.

```bash
ffprobe -v error -select_streams <idx> -show_entries packet=pts_time,size -of json clip.mp4
ffmpeg -v error -i clip.mp4 -map 0:<idx> -c copy -f rawvideo dump.bin
```

- Watch the ffprobe stream specifier: `d:N` selects the N-th *data* stream, not
  global stream index `N`. Use the bare global index from the stream list.

## Schema lineage

The first message declares `proto_file_name = dvtm_NEO2.proto` (v02.00.07).
That schema is DJI-internal and not public, but its layout matches the recovered
schemas in
[AdrianEddy/telemetry-parser](https://github.com/AdrianEddy/telemetry-parser)
(MIT/Apache-2.0): `dvtm_eagle4_wa530.proto` (v02.00.10) plus the shared
`dvtm_library.proto`, which define the message types referenced below.

Caveat: telemetry-parser's own DJI reader falls back to its `wm169` schema for
Neo 2 messages and silently drops the drone block. Use the field map below —
it is what `src/cammeta.ts` implements.

## Message tree

```
ProductMeta                       one per video frame
├── 1 clip_meta                   first sample only
├── 2 stream_meta                 first sample only
└── 3 frame_meta                  every sample
    ├── 1 frame_meta_header       frame_timestamp (µs since power-up)
    ├── 2 camera_frame_meta
    ├── 3 imu_frame_meta          absent on Neo 2
    ├── 4 drone_frame_meta
    └── 5 gimbal_frame_meta
```

## Frame-meta field map

Paths use `frame_meta.<block>.<field>` numbering (protobuf field ids). Wire
types: `varint` = base-128 integer, `f32`/`f64` = IEEE little-endian float.

### Camera block (frame_meta.2)

| Path | Message | Encoding | Meaning |
|---|---|---|---|
| `2.3` | `ISO` | varint | ISO (SRT `iso`) |
| `2.4` | `ExposureTime` | — | shutter time (SRT `shutter`) |
| `2.6` | `WhiteBalanceCCT` | varint | color temperature, K (SRT `ct`) |
| `2.11` | `AbsoluteAltitude` | f32 | altitude MSL, meters (SRT `abs_alt`) |
| `2.12` | `SensorTemperature` | f32 | sensor temperature, °C — **not an altitude**, despite looking like one |
| `2.14` | `FNumber` | — | f-number (SRT `fnum`) |

### Drone block (frame_meta.4)

| Path | Message | Encoding | Meaning |
|---|---|---|---|
| `4.3` | `EulerAngle` | varint, deci-degrees | **body** attitude NED: `1` pitch, `2` roll, `3` yaw. Yaw is the drone heading, valid even while hovering; the absolute compass reference is unconfirmed |
| `4.4` | `GpsBasic` | — | `1` `PositionCoord { 2 lat, 3 lon }` f64 WGS-84 (SRT `latitude`/`longitude`); `2` `gps_altitude_mm` varint. `0, 0` means no GPS lock, not a location |
| `4.5` | `RelativeAltitude` | f32 | altitude above take-off point, **millimeters** (SRT `rel_alt`, ÷1000 → m) |
| `4.7` | `RC_Mode` | varint | remote controller mode (semantics undecoded) |
| `4.8` | `Barrier_Distance` | — | obstacle distance (semantics undecoded) |
| `4.11` | `GimbalAngleDeviation` | 3 × f32 | gimbal angle deviation x/y/z (absent in observed Neo 2 samples) |

### Gimbal block (frame_meta.5)

| Path | Message | Encoding | Meaning |
|---|---|---|---|
| `5.1` | `MetaHeaderOfDevice` | — | device header: `1` device_id, `2` device_type (`1` = physical), `3` device_sub_type (**`3` = `DEVICE_SUB_TYPE_GIMBAL`**), `4` device_name, `5` device_frequency (Hz), `6` device_timestamp (ms since power-up) |
| `5.2` | `EulerAngle` | varint, deci-degrees | **gimbal (camera) attitude** NED: `1` **pitch**, `2` roll, `3` yaw |

**Gimbal pitch is `frame_meta.5.2.1`** — deci-degrees, signed: `0` = horizon,
negative = down, `-900` = straight down. It is the *stabilized* camera pitch
(it barely moves when the body pitches) and matches DJI's photo XMP convention
`drone-dji:GimbalPitchDegree` exactly. Together with `5.2.3` (gimbal yaw) it is
the camera look direction.

No other subfields were observed in the gimbal block (331 sampled frames of one
flight).

## Gotchas

- **No epoch timestamp.** `frame_timestamp` is microseconds since power-up.
  Absolute time comes from the SRT cues or the filename timestamp; frame
  alignment from the sample index.
- **proto3 zero omission:** default-valued fields are absent, not zero-coded.
  Gimbal roll is almost always missing (= 0.0°); a missing gimbal pitch can
  mean 0.0°, not "unknown".
- `2.12 SensorTemperature` vs `2.11 AbsoluteAltitude`: both f32, easy to
  confuse — check the field number.
- **Yaw conventions are not fully pinned down.** Gimbal yaw tracks body yaw
  with a roughly constant offset (≈13° in one video flight, ≈31° between
  `GimbalYawDegree` and `FlightYawDegree` in photos of the same session) —
  pan position, mounting or calibration offset, unresolved. Body yaw
  (`4.3.3`) is the safe heading source; treat gimbal yaw as a relative
  refinement until calibrated.
- GPS fallback when the protobuf walk fails: byte signature `22 1a 0a 12 11
  <lat f64> 19 <lon f64>` (tag `0x11` latitude, tag `0x19` longitude).

## Verification

- GPS, altitude, ISO, CCT and shutter fields were checked value-by-value
  against the `.SRT` sidecar of `DJI_20261017143040_0039_D.MP4`.
- Gimbal block (2026-11-02, `DJI_20260816093933_0007_D.MP4`, 165 s flight):
  `5.1.3 = 3` matches `DEVICE_SUB_TYPE_GIMBAL`; `5.1.6` spans exactly the clip
  duration in ms. Gimbal pitch is uncorrelated with body pitch (r = −0.15 while
  body pitch swung ±27°) — the stabilization signature — while gimbal yaw
  follows body yaw (r = 0.94). Signs and range match the photo XMP of the same
  session (`GimbalPitchDegree` −12.2° / +14.6° / −4.3°).

## Tooling

- `src/cammeta.ts` — this repo's decoder (protobuf walk + GPS byte-scan
  fallback), consumed by `src/telemetry.ts`.
- The archive workspace this repo lives in carries standalone mirrors:
  `scripts/flight_map/cammeta.mjs` and
  `scripts/telemetry_overlay/telemetry_dump.mjs`.
