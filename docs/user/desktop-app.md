# Desktop app

## Getting the app

Grab the packaged desktop app (Windows NSIS installer or portable exe, Linux AppImage) from [GitHub Releases](https://github.com/MrManny/drone-path/releases), or run `npm run build && npm run app` from a checkout.

## Loading a recording

Launching the app lands in the review workspace with no recording loaded: the transport, timeline and export controls sit disabled, the map pane reads *No telemetry yet*, and the centered **Open…** button in the footage pane is the obvious start — the header's **Open…** and `Ctrl+O` do the same. Picking a drone video — the dialog starts in the folder the last recording was opened from — opens the player right after the recording is probed, its telemetry is loaded and the view is planned: no tile warm-up in between. The map draws the flight trail immediately and loads its tiles on demand, and playback is ready right away. Changing the map style, zoom or view in [Map appearance](#map-appearance) starts loading the tiles for the new view instead.

![Empty workspace with the centered Open call to action](../images/app-empty-workspace.jpg)

*The workspace before a recording loads: disabled rows, a centered **Open…** call to action in the footage pane, and an empty map pane.*

## Reviewing a flight

The review workspace shows the footage and the synchronized flight map at once: the video fills the preview beside the map pane, which keeps the flight trail, drone position and HUD chips and shares the playhead with the video. **Swap** in the footer (or `S`) turns the map into a corner overlay on the footage when you want the full frame for the video. Play, pause and scrubbing drive both panes from one timeline, so the map and the footage never drift apart. Every playback control has a [keyboard shortcut](keyboard-shortcuts.md).

![Footage and synchronized flight map side by side in the review workspace](../images/app-review-split.jpg)

*The review workspace: footage and the synchronized flight map side by side, with the timeline below.*

![Flight map as a synchronized corner overlay on the footage](../images/app-review-overlay.jpg)

*Swapped view: the flight map overlays the footage while both stay on the same frame.*

At the compact 1024×600 minimum window size the same workspace fits into less space, with every control still in reach.

![Review workspace at the compact 1024x600 window size](../images/app-review-compact.jpg)

*The review workspace at the compact 1024×600 window size.*

## Looping a passage

The timeline header holds the loop controls — icon-only buttons for **Set loop in (I)**, **Set loop out (O)** and **Clear loop (Esc)** — and a readout of the marked passage. Below it the timeline shows the video as a filmstrip with the loop band over it. Press `I` to mark the loop in point and `O` the out point — or drag the band's ends with the mouse — and the passage between them plays on repeat until you clear the loop with `Esc`.

![Timeline with loop in and out points marked](../images/app-loop-points.jpg)

*Loop in and out points marked on the timeline; the passage between them plays on repeat.*

## Export

The **Export…** button in the header is the export entry point (it stays disabled until a recording is loaded). The dialog opens with an **Output preview** beside the form: the preview shows the exact map output — the very scene the export captures, planned at the output size — and states the rule under the frame: *Export renders the map, not the source video.*

With a loop set the form groups into *What* — *Full recording* or the *In–Out segment* (set the loop points with `I` / `O` first; once a loop is set the segment comes preselected) — and *How* — the output size and the encoding: format (H.264 or H.265), quality (*Near-lossless* down to *Low*) and speed (*Balanced* or *Faster*). Without one it just sets size and encoding.

Press **Start export**, pick the destination file, and follow the progress beside the preview until the done state names the rendered output. The app remembers the encoding choices between launches like the look settings, and the output size while the recording is open.

![The export dialog with the output preview beside the What and How form](../images/app-export-form.jpg)

*The Export dialog: the output preview shows the exact map output beside the What and How form.*

![Export running with progress beside the frozen output preview](../images/app-export-running.jpg)

*An export running: the preview freezes on the request while progress reports beside it.*

![Export done naming the rendered output](../images/app-export-done.jpg)

*Export done: the summary and the output path name the rendered file.*

At the compact 1024×600 minimum window size the preview shrinks and the form stays in reach.

![Export dialog at the compact 1024x600 window size](../images/app-export-compact.jpg)

*The Export dialog at the compact 1024×600 window size.*

## Map appearance

The **Map settings** button in the footer opens the *Map appearance* popover with the map look settings: map style (satellite or topographic), view (*Overview* shows the whole track at once, *Follow* keeps the drone centered with the map sliding under it), zoom and zoom-out levels, the intro and outro zoom transitions, and the HUD chips (heading arrow, altitude (ALT) and speed (SPD) — altitude and speed are off by default, and altitude is unavailable when the telemetry has none). The panel repeats the rule under the settings: *Export renders the map, not the source video.* Every change applies at once to the preview and the next export. The app remembers these settings between launches: the next launch starts with the last-used look, and a fresh install — or settings the app cannot read — starts at the defaults.

![The map appearance panel with map style, view, zoom and HUD chips](../images/app-review-map-appearance.jpg)

*The map appearance panel: the map look settings live beside the workspace they affect.*

## Updates

Packaged builds update themselves: when a newer [release](https://github.com/MrManny/drone-path/releases) exists, the app downloads it in the background and asks once whether to **Restart now** into it or keep working with **Later**; the update then installs when you quit.

## Help

The **Help** icon in the footer opens this manual inside the app. It is bundled with the app, so it works offline.

## Notes

The app embeds Chromium and needs no system browser; ffmpeg and ffprobe are bundled too (a config file's `ffmpeg`/`ffprobe` keys work like the CLI's flags, and `PATH` remains a fallback). Map tiles need internet on the first run and are cached like CLI tiles (see [Tiles and attribution](tiles-and-attribution.md)). One recording at a time — batch rendering stays a CLI concern.
