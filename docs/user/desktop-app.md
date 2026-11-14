# Desktop app

## Getting the app

Grab the packaged desktop app (Windows NSIS installer or portable exe, Linux AppImage) from [GitHub Releases](https://github.com/MrManny/drone-path/releases), or run `npm run build && npm run app` from a checkout.

## The menu bar

Every command lives in the slim menu bar at the top of the workspace, as in other Windows apps: **File** holds **Open…** (`Ctrl+O`), **Export video…**, **Export telemetry…**, **Map appearance…** and **Exit**; **View** holds **Toggle PiP** (`P`); **Help**, at the right edge, opens the Help overlay — this manual — and lists **About** under a separator. Items that cannot act right now — export, telemetry and Toggle PiP without a loaded recording — sit disabled. The whole menu works with the mouse or the [keyboard](keyboard-shortcuts.md#menu-bar), and `Exit` closes the app, stopping a running export only after a confirmation.

## Loading a recording

Launching the app lands in the review workspace with no recording loaded: the transport, timeline and export menu items sit disabled, and the map pane reads *No flight path yet*.

To load a recording, use the **Open…** button in the recording pane — **File → Open…** and `Ctrl+O` do the same. The dialog starts in the folder the last recording was opened from.

Picking a drone recording opens the player as soon as the recording is read, its telemetry is loaded and the map is set up — no tile warm-up in between. The map draws the flight trail immediately and loads its tiles on demand, and playback is ready right away. Changing the map style, zoom or view in [Map appearance](#map-appearance) starts loading the tiles for the new view instead.

![Empty workspace with the Open call to action](../images/app-empty-workspace.jpg)

*The workspace before a recording loads: disabled rows, an **Open…** call to action in the recording pane, and an empty map pane.*

## Reviewing a flight

The review workspace shows the recording and the synchronized flight map at once: the recording fills the preview beside the map pane, which keeps the flight trail, drone position and HUD chips and shares the playhead with the recording.

**View → Toggle PiP** in the menu bar (or `P`) turns the map into a corner overlay on the recording when you want the full frame. Play, pause and scrubbing drive both panes from one timeline, so the map and the recording never drift apart. Every playback control has a [keyboard shortcut](keyboard-shortcuts.md).

![Recording and synchronized flight map side by side in the review workspace](../images/app-review-split.jpg)

*The review workspace: the recording and the synchronized flight map side by side, with the timeline below.*

![Flight map as a synchronized corner overlay on the recording](../images/app-review-overlay.jpg)

*PiP view: the flight map overlays the recording while both stay on the same frame.*

At the compact 1024×600 minimum window size the same workspace fits into less space, with every control still in reach.

![Review workspace at the compact 1024x600 window size](../images/app-review-compact.jpg)

*The review workspace at the compact 1024×600 window size.*

## Marking a passage

The timeline header holds the in/out-point controls — one button group with **Set in point (I)**, **Set out point (O)** and **Clear in and out points (Esc)** — and a readout of the marked passage (`in 0:12 · out 0:34`). Below it the timeline shows the recording as a filmstrip with the In–Out segment over it.

Press `I` to mark the in point and `O` the out point. One point already marks a passage: the in point plays to the end of the recording, the out point from its start, and the readout and the segment show that passage; setting the second point narrows it. Setting a point past the other replaces it — marking an in point beyond an out point clears that out point, and the other way around — so the in point always stays before the out point. Dragging the In–Out segment's edge handles is a pointer-only way to fine-tune the marked points; the keyboard path is `I` / `O` and the in/out-point buttons. The marked passage plays on repeat until you clear the points with `Esc`.

![Timeline with in and out points marked](../images/app-loop-points.jpg)

*In and out points marked on the timeline; the passage between them plays on repeat.*

## Export

The **Export video…** item in the File menu is the export entry point; it stays disabled until a recording is loaded. The dialog opens with an **Output preview** beside the form: the preview shows the exact map output — the very scene the export captures, planned at the output size — and states the rule under the frame: *Export captures the map, not the source recording.*

The form groups into *Export range* and *Output and encoding*:

- *Export range* — *Full recording* or the *In–Out segment*. Mark the in or out point with `I` / `O` first; once one is marked, the segment comes preselected — a lone in point exports to the end of the recording, a lone out point from its start.
- *Output and encoding* — the output size and the encoding: codec (H.264 or H.265), quality (*Near-lossless* down to *Low*) and encode speed (*Balanced* or *Faster*).

Without an In–Out segment, the form just sets size and encoding.

Press **Start export**, pick the destination file, and follow the progress beside the preview until the done state names the exported file. The app remembers the encoding choices between launches like the look settings, and the output size while the recording is open.

![The export dialog with the output preview beside the export form](../images/app-export-form.jpg)

*The Export video dialog: the output preview shows the exact map output beside the export form.*

![Export running with progress beside the frozen output preview](../images/app-export-running.jpg)

*An export running: the preview freezes on the request while progress reports beside it.*

![Export done naming the exported file](../images/app-export-done.jpg)

*Export done: the summary and the output path name the exported file.*

At the compact 1024×600 minimum window size the preview shrinks and the form stays in reach.

![Export dialog at the compact 1024x600 window size](../images/app-export-compact.jpg)

*The Export video dialog at the compact 1024×600 window size.*

## Exporting telemetry

The **Export telemetry…** item in the File menu writes the same per-frame telemetry document as the CLI's `--telemetry-json`, straight from the loaded recording and without producing a video. One record per source frame covers the time, position, altitude, body and gimbal attitude, heading and camera exposure.

The scope follows the in and out points automatically: with the In–Out segment marked — one point is enough — the document covers just those frames, resolved the same way as the segment export (a lone in point to the end of the recording, a lone out point from its start), keeping the recording's own frame numbers, and with no points marked the full recording. The item's tooltip states the scope before you choose it.

Choosing it opens the native save dialog, which suggests `<recording>.telemetry.json` in the export folder; cancelling it starts nothing and leaves the workspace untouched. On confirm a compact dialog reports the export and then names the kept file and the scope it covers, with **Reveal in folder** opening its folder. For the same recording and range the file is byte-identical to the CLI output (see [CLI usage](cli.md)).

The save dialog offers the same five formats as the CLI's `--track-out`: a GPX track (`.gpx`), a GeoJSON track (`.geojson`), a KML or KMZ track (`.kml`, `.kmz`), and the telemetry document (`.json`). The file name picks the format — the typed extension decides what is written, and the suggested `.telemetry.json` name keeps the document the default for a bare name. The track formats carry the flight path itself: vertices at decoded GPS fixes, gaps breaking the line into segments, absolute/GPS altitude in meters above mean sea level, and times only where a recording carries trustworthy UTC (today none does, so a KML track is a plain line per segment). The full field policy lives in [CLI usage](cli.md#flight-track-export).

Every format honors the In–Out range exactly like the telemetry document: with the segment marked the file covers just those frames, and without it the full recording. For the same recording and range the app and the CLI write byte-identical files.

## Map appearance

The **File → Map appearance…** menu item opens the *Map appearance* popover with the map look settings (it is available with or without a recording, since the look applies to future exports):

- **Map style** — satellite or topographic.
- **View** — *Overview* shows the whole track at once; *Follow* keeps the drone centered with the map sliding under it.
- **Zoom** — zoom and zoom-out levels, plus the intro and outro zoom transitions.
- **Trail color** — any RGB or RGBA hex color like `#e63946` or `#e63946cc`; leave it empty to keep the map style's own trail color.
- **HUD chips** — heading arrow, altitude (ALT) and speed (SPD). Altitude and speed are off by default, and altitude is unavailable when the telemetry has none.

Every change applies at once to the preview and the next export. The app remembers these settings between launches: the next launch starts with the last-used look, and a fresh install — or settings the app cannot read — starts at the defaults.

![The map appearance panel with map style, view, zoom and HUD chips](../images/app-review-map-appearance.jpg)

*The map appearance panel: the map look settings live beside the workspace they affect.*

## Updates

Packaged builds update themselves: when a newer [release](https://github.com/MrManny/drone-path/releases) exists, the app downloads it in the background and asks once whether to **Restart now** into it; closing the dialog keeps working, and the update installs when you quit. Should the restart fail, the dialog says so and the update still installs when you quit.

## Help

The **Help** menu's first item opens the Help overlay — this manual — inside the app. It is bundled with the app, so it works offline.

**Help → About** opens a small dialog with the app's identity: the *drone / path* lockup, the installed version below it, the MIT license line and a link to the project repository, which opens in the default browser. The version reads `MAJOR.MINOR.PATCH` in a release build (like `0.8.1`) and adds `+` with the short commit (like `0.8.1+cb40df32`) in every other build, so a support answer names the exact build; release builds never carry the commit suffix.

## Notes

- The app embeds Chromium and needs no system browser; ffmpeg and ffprobe are bundled too — a config file's `ffmpeg`/`ffprobe` keys work like the CLI's flags, and `PATH` remains a fallback.
- Map tiles need internet on the first run and are cached like CLI tiles (see [Tiles and attribution](tiles-and-attribution.md)).
- One recording at a time — batch rendering stays a CLI concern.
