# neo2-flightpath

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
