# drone-path

## 0.11.0

- **New:** Flight track files: `--track-out <file>` writes the decoded
  flight track in the format the file extension picks — GPX (`.gpx`),
  GeoJSON (`.geojson`), KML/KMZ (`.kml`/`.kmz`) — or the existing
  telemetry JSON document (`.json`, unchanged bytes). Vertices sit at
  decoded GPS fixes with telemetry gaps breaking the line, altitude is
  the absolute/GPS altitude in meters above mean sea level, and times
  appear only where a recording carries trustworthy UTC — none does
  today (the CAM-meta device timestamp counts since power-up), so KML
  exports plain line segments instead of a timed flythrough. The
  desktop **Export telemetry…** dialog offers the same five formats and
  honors the In–Out range; for the same recording and range the app and
  the CLI write byte-identical files. `--telemetry-json <file>` is a
  deprecated alias of `--track-out <file>.json` — same output, warns on
  use, removed in a future version — and mixing the two spellings in
  one run is an error. A frame range of a single frame is now valid
  everywhere ranges are accepted.
- **New:** The timeline shows a lone in or out point as a half-open
  In–Out segment — the in point runs to the end of the recording, the
  out point from its start — and the readout names the same passage.
  Playback wrap and both exports honor a lone point, setting a point
  past the other replaces it, and the readout announces point changes
  to screen readers.
- **New:** The app's copy is unified and the dialogs are polished: the
  marked range is the In–Out segment with "Set in point" / "Set out
  point" controls and an `in 0:12 · out 0:34` readout, the export flow
  says "export" throughout with codec and encode-speed labels, every
  failure reads as a sentence with a next step (raw text under
  "Technical details"), and a failed update restart is reported. Each
  dialog dismisses through its header ✕ alone, the export-done dialog
  leads with "Export finished." and one accent primary (**Reveal in
  folder**), output paths wrap with a full-path tooltip, and export and
  telemetry phase text is announced in a live region and keeps keyboard
  focus through phase changes.
- **New:** Accessibility hardening for the menu bar and dialogs: AltGr
  characters type normally in every field, Left/Right move between the
  menu labels with disabled rows announcing themselves, Tab stays
  inside dialogs and the Help overlay, and the timeline scrubber
  announces times instead of raw frame numbers.
- **New:** The transport and loop controls are compact and stable: the
  Play/Pause button is icon-only with a tooltip and accessible name,
  the in/out-point buttons form one group beside a fixed readout slot,
  and toggling playback or marking points no longer shifts neighboring
  controls. The ALT/SPD readouts sit in a strip along the map card's
  bottom edge, the Map appearance popover docks left of the map card
  and opens from **File → Map appearance…**, the empty workspace drops
  its tooling hint and status footer, the header hides the duration
  until a recording loads, and the map card shows "Preparing map…"
  while its tiles load.
- **Internal:** Code consolidation and dead-export cleanup from a
  refactoring pass; no behavior changes.

## 0.10.0

- **New:** Telemetry now comes from the embedded CAM meta (DVTM) stream
  whenever a recording has one; the `.SRT` sidecar is only used when no
  CAM meta stream is present. A CAM meta stream without GPS positions
  fails the run with a clear error instead of silently falling back to
  the sidecar.
- **New:** The opt-in OpenTelemetry trace export is removed along with
  its `OTEL_*` environment variables. Stage logs, progress reporting
  and rendered output are unchanged.

## 0.9.0

- **New:** The flight trail is now configurable: `--trail-color <hex>`
  (RGB or RGBA hex like `#e63946` or `#e63946cc`, `#` optional) and the
  `trailColor` setting recolor the flight trail, the drone marker and
  the HUD accents. Glow and casing are derived from the chosen color,
  so the layered trail stays readable on both map styles; omitting the
  option keeps the per-style theme defaults.
- **New:** `--telemetry-json <file>` exports per-frame telemetry —
  time, position, altitude, body and gimbal attitude, heading and
  camera exposure — as one versioned JSON document with a record per
  source frame; the schema is checked in as
  `docs/telemetry-json.schema.json`. The desktop workspace writes the
  same document through Export telemetry…, straight from the loaded
  recording (the In–Out segment or the full recording) and
  byte-identical to the CLI output.
- **New:** The desktop workspace has a top menu bar with the workspace
  actions moved into it: **File** holds Open… (Ctrl+O), Export video…,
  Export telemetry…, Settings and Exit, **View** holds Swap (S), and
  right-aligned **Help** holds Documentation and About. It follows
  Windows menu conventions (click or Alt opens, hover switches, arrows
  navigate, Enter/Space activate, Esc closes, Alt+F/V/H mnemonics) with
  the accent-forward menu state styling. "Export…" is now "Export
  video…" on every surface, the header and status footer keep only
  their informational content, the auto-hidden native Electron menu is
  gone, and Exit still guards against closing during a running export.
- **New:** **Help → About** shows the drone / path lockup, the running
  build's version — `MAJOR.MINOR.PATCH` for releases,
  `MAJOR.MINOR.PATCH+<short commit>` for every other build, injected at
  build time — an MIT license line, and a link that opens the
  `MrManny/drone-path` repository in the default browser.

## 0.8.1

- **Fixed:** The GitHub repository moved to `MrManny/drone-path`:
  `npx github:` commands, links and the desktop app's update feed point
  at the new home, and old URLs redirect.
- **Internal:** Routine dependency updates.

## 0.8.0

- **New:** The tool is now called **Drone Path**. The rename is a clean
  break with no compatibility aliases — on upgrade, use the `drone-path`
  command (previously `neo2-flightpath`), move the config file to
  `.dronepath.json` (from `.neo2flightpath.json`), and rename the tile-cache
  environment variable to `DRONEPATH_TILE_CACHE` (from
  `NEO2_FLIGHTPATH_TILE_CACHE`). The per-user data directory moves to
  `drone-path`, leaving the old one behind.
- **New:** The desktop app ships as "Drone Path" under a new app identity.
  Installed apps do not auto-update in place — uninstall the old version
  and install the new one.

## 0.7.0

- **New:** The desktop player is now a synchronized video-and-map review
  workspace: dedicated footage and flight-map panes with a swappable overlay
  layout, a bare map sidebar with a map appearance popover, and a timeline of
  square preview stills spread from the first frame to the last with a
  draggable loop band and icon-only loop controls. The transport controls sit
  centered under the footage.
- **New:** The app opens straight into the review workspace — the landing
  screen is gone and no tile warm-up stands between the user and the footage.
  Before a recording is loaded the workspace shows its disabled controls with
  an accent **Open…** call to action in the footage pane, a quiet "No
  telemetry yet" map pane and a "No recording loaded" status bar. A picked
  recording loads right into the player, with map tiles streaming on demand
  (rendering and exporting still prefetch their tiles beforehand).
- **New:** The export dialog is wider and shows a map-only output preview at
  the export's exact size, with range, output-size and encoding choices
  clearly separated and the familiar destination, progress, cancel, done and
  error states beside the preview.
- **New:** New color scheme: dark neutral surfaces with a warm coral accent,
  sand loop state and warmer semantic tones, plus one shared accent-colored
  flight trail in the map island and in rendered frames.
- **New:** The app icon is the final branded artwork: a circular drone badge
  rasterized to a metadata-free 512x512 master and re-derived for every
  platform format (Windows ICO, Linux icon set).
- **Fixed:** Loading a second recording now switches the footage and the
  filmstrip to the new recording instead of replaying the previous one's bytes
  from a URL-keyed cache.

## 0.6.1

- **Fixed:** Maintenance release with updated dependencies that contain
  security fixes.

## 0.6.0

- **New:** Renders and exports no longer need a local ffmpeg install:
  static ffmpeg and ffprobe 7.1.0 binaries ship with the desktop app and
  the npm package. `--ffmpeg <path>` and `--ffprobe <path>` override
  them, PATH remains a fallback, and installing downloads both tools in
  a postinstall step (~250 MB).
- **New:** The export dialog and the CLI now configure the encoder:
  video codec (H.264 or H.265), quality (near-lossless down to low) and
  encoding speed. The defaults reproduce the previous output exactly.
- **New:** The export dialog opens on the In–Out segment when a loop is
  set and keeps the output size for the session.
- **Fixed:** Dialogs now manage keyboard focus: opening a dialog moves
  focus onto it, closing hands it back to the control that opened it.

## 0.5.0

- **New:** The player opens as soon as the map tiles around the drone at
  the first frame are warm; the remaining tiles the map can show keep
  loading into the cache behind a small "Warming tiles…" hint, and
  changing the map style, zoom or view moves the loading onto the new
  plan.
- **New:** The settings panel's look — map style, view, zoom, intro/outro
  and HUD chips — is remembered between launches, and the Open dialog
  starts in the folder the last recording was opened from. A fresh
  install, or a state file the app cannot read, starts at the documented
  defaults.
- **New:** Help now opens a full offline user manual inside the app —
  how playback, settings and export fit together, keyboard shortcuts and
  a CLI/config reference — from the landing card and the control bar.
- **Fixed:** All tile downloads share one polite queue, so the combined
  request rate stays inside the 2-per-second tile budget even when
  several loading lanes run at once.
- **Fixed:** Tile cache write failures (a full disk, an unwritable
  cache, a cache path that is not a directory) now fail the affected
  tile with an error naming the cache instead of silently degrading to a
  placeholder.

## 0.4.0

- **New:** The desktop app now updates itself from GitHub Releases:
  packaged builds download a newer version in the background and ask
  once whether to restart into it. Windows releases gain a self-updating
  NSIS installer next to the portable exe (which never self-updates).
- **Fixed:** Escape now closes the Settings and Export dialogs even
  while a select field is focused: the first Escape is still reserved
  for the select's own dropdown, and the second one closes the dialog.
- **Fixed:** The export dialog's Width and Height fields now show
  exactly what the export renders: typing an odd size and leaving the
  field commits the even size (rounded down, at least 64 px), so the
  fields, the export and the done summary always agree.
- **Fixed:** The preparation progress bar no longer shrinks mid-load:
  its percent now grows monotonically to 100 across probing, telemetry,
  view planning and the tile pre-warm.
- **Fixed:** The map trail now grows with playback and ends at the
  drone: the flown path is drawn up to the current frame's position
  instead of stalling on the decimated points, so the trail appears and
  grows on every recording (including hovering and straight flights) in
  the app and exported overlays alike.
- **Internal:** The test tree is type-checked before the unit tests
  run, and the OpenTelemetry packages are up to date.

## 0.3.0

- **New:** The desktop app — pick a recording and watch its flight path on a
  map in sync with the footage, one shared timeline scrubber and a swappable
  picture-in-picture layout. It ships as a Windows portable executable and a
  Linux AppImage, with its own application icon and the window title
  "Neo2 Flightpath".
- **New:** Export the look you see: a modal renders the preview as a video,
  the full recording or the In–Out loop segment at a chosen size, written
  through a native save dialog. Exports run as one cancelable job and are
  verified before they replace the chosen file, so a failed or canceled
  export never touches an existing file; "Reveal in folder" and "Open video"
  act on the exported file, and a refused cancel explains itself.
- **New:** Playback and review: speed 1x–4x, a loop region with I/O points
  that auto-engage and wrap on repeat (Esc or Clear to remove), and keyboard
  shortcuts for play/pause, speed, frame stepping, one-second jumps and
  swapping the views. Seeking is frame-exact: End reaches the last frame and
  every step lands exactly where requested.
- **New:** A settings panel (cog button): map style, view, zoom/zoom-out,
  intro/outro seconds and HUD chips mirror the CLI options and restyle the
  preview instantly, fetching any missing map tiles on demand. The alt chip
  hides itself when the telemetry has no altitude.
- **New:** Preparation progress on the landing card: a bar that advances one
  step per preparation stage and per warmed map tile, and the status notice
  names the running stage.
- **New:** Errors and progress read as plain sentences with the original
  system text under "Technical details", and the control bar fits the
  1024×600 minimum window.
- **New:** The map trail is drawn with one incremental update in the app and
  the CLI alike; the `--trail` option is removed — drop the `trail` key from
  config files.
- **Fixed:** One rule now counts GPS fixes in every telemetry source: exactly
  (0, 0) is the no-lock placeholder, so near-equator and near-prime-meridian
  coordinates count as fixes again, and fix counts agree between the SRT
  sidecar and camera metadata. Frames after the last GPS fix hold that fix
  instead of jumping back to the flight's start.
- **Fixed:** ffmpeg/ffprobe failures surface their real cause instead of a
  false "no telemetry found", mistyped numbers in config files fail fast
  naming the option instead of being silently coerced, and odd canvas
  dimensions normalize to even.
- **Fixed:** On Windows, output names differing only in case are one file —
  collision suffixing and the overwrite guard agree on it (on Linux and macOS
  they stay two distinct names).
- **Internal:** The app and the headless CLI share one map renderer, and CLI
  output stays frame-exact. Option defaults live in one table, the
  `--out-dir` default is documented as the `out` folder, CLI help names the
  offending flag, and the agent helpers move project statuses past the first
  result page.

## 0.2.0

- **New:** See where render time goes — opt-in OpenTelemetry traces for the
  render pipeline via `OTEL_EXPORTER_OTLP_ENDPOINT` (OTLP/HTTP protobuf);
  nothing is loaded or sent without it.
- **Internal:** Release notes are now curated for users; Dependabot keeps
  `@types/node` on the Node 24 line.

## 0.1.1

- **Internal:** Code base restructuring and README improvements.

## 0.1.0

- **New:** First release — flight-path map overlay videos from DJI drone
  recordings at exactly the source frame rate and frame count, with telemetry
  from the `.SRT` sidecar or the embedded CAM-meta (DVTM) stream; `satellite`
  and `topo` map styles, batch processing, config file support, `--json`
  summaries and `out` as the default output directory.
