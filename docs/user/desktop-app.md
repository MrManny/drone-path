# Desktop app

## Getting the app

Grab the packaged desktop app (Windows NSIS installer or portable exe, Linux AppImage) from [GitHub Releases](https://github.com/MrManny/neo2-flightpath/releases), or run `npm run build && npm run app` from a checkout.

## Loading a recording

Launching the app lands in the review workspace with no recording loaded: the workspace rows are disabled, the map pane reads *No telemetry yet*, and the centered **Open…** button in the footage pane is the one action (**Open…** in the header and `Ctrl+O` do the same). Picking a drone video — the dialog starts in the folder the last recording was opened from — opens the player right after the recording is probed, its telemetry is loaded and the view is planned: no tile warm-up in between. The map draws the flight trail immediately and loads its tiles on demand, and playback is ready right away. Changing the map style, zoom or view in [Map appearance](#map-appearance) starts loading the tiles for the new view instead.

## Reviewing a flight

The review workspace shows the footage and the synchronized flight map at once: the video fills the preview beside a map card that names its look ("Satellite · Overview"), keeps its flight trail, drone position and HUD chips on the frame, and shares the playhead with the video. **Swap view** (or `S`) turns the map into a corner overlay on the footage when you want the full frame for the video. Play, pause and scrubbing drive both panes from one timeline, so the map and the footage never drift apart. Every playback control has a [keyboard shortcut](keyboard-shortcuts.md).

![Footage and synchronized flight map side by side in the review workspace](../images/app-review-split.jpg)

*The review workspace: footage and the synchronized flight map side by side, with the timeline below.*

![Flight map as a synchronized corner overlay on the footage](../images/app-review-overlay.jpg)

*Swapped view: the flight map overlays the footage while both stay on the same frame.*

## Looping a passage

The timeline under the preview shows the video as a filmstrip with the loop band over it. Press `I` to mark the loop in point and `O` the out point — or drag the band's ends with the mouse — and the passage between them plays on repeat until you clear the loop with `Esc`.

![Timeline with loop in and out points marked](../images/app-loop-points.jpg)

*Loop in and out points marked on the timeline; the passage between them plays on repeat.*

## Export

The **Export…** button in the header renders the recording with the look you see in the preview. Choose *Full recording* or the *In–Out segment* (set the loop points with `I` / `O` first; once a loop is set the segment comes preselected), set the output size and the encoding — format (H.264 or H.265), quality (*Near-lossless* down to *Low*) and speed — press **Start export**, and pick the destination file. The app remembers the encoding choices between launches like the look settings, and the output size while the recording is open.

![The export dialog with segment choice, output size and encoding](../images/app-export-dialog.jpg)

*The Export dialog: render the full recording or just the In–Out segment, at the size and encoding you pick.*

## Map appearance

The **Map appearance** button in the header opens a small panel with the map look settings: map style (satellite or topographic), view mode (follow keeps the drone centered with the map sliding under it; overview shows the whole track at once), zoom and zoom-out levels, the intro and outro zoom transitions, and the HUD chips (heading, altitude and speed — altitude and speed are off by default). Every change applies at once to the preview and the next export. The app remembers these settings between launches: the next launch starts with the last-used look, and a fresh install — or settings the app cannot read — starts at the defaults.

![The map appearance panel with map style, view, zoom and HUD chips](../images/app-review-map-appearance.jpg)

*The map appearance panel: the map look settings live beside the workspace they affect.*

## Updates

Packaged builds update themselves: when a newer [release](https://github.com/MrManny/neo2-flightpath/releases) exists, the app downloads it in the background and asks once whether to **Restart now** into it or keep working with **Later**; the update then installs when you quit.

## Help

The **Help** icon in the status bar opens this manual inside the app. It is bundled with the app, so it works offline.

## Notes

The app embeds Chromium and needs no system browser; ffmpeg and ffprobe are bundled too (a config file's `ffmpeg`/`ffprobe` keys work like the CLI's flags, and `PATH` remains a fallback). Map tiles need internet on the first run and are cached like CLI tiles (see [Tiles and attribution](tiles-and-attribution.md)). One recording at a time — batch rendering stays a CLI concern.
