# drone-path-desktop

## 1.2.1

- **New:** Browse Archive flights in date groups with thumbnail cards, sort
  newest or oldest first, and search by recording filename.
- **New:** “What filmed here?” now prompts you to select a map point and
  shows a Cancel button while point selection is active. Watched-folder
  controls and missing-clip cleanup moved into the Folders dialog.

## 1.2.0

- **New:** Browse your recording library in the new multi-clip Archive
  workspace with watched folders, a Canvas-rendered multi-flight map (showing
  higher-detail flight tracks when zoomed in), "What filmed here?"
  point-in-view clip search, kinematic and date/distance filtering, lazy
  poster thumbnails, offline drive support with safe pruning, and combined
  GPX, GeoJSON, KML, KMZ, and HTML map exports.

## 1.1.1

- **New:** Open the official Drone Path website from Help → About.

## 1.1.0

- **Fixed:** Improve keyboard navigation, modal focus, timeline focus
  indicators, status announcements, contrast, and layout at high zoom.
- **Fixed:** Keep menus and exports responsive when switching recordings.
  Correct playback when resuming from the end, handle single-frame loops,
  and keep filmstrip thumbnails in sync with the recording.
- **Fixed:** Restrict export and track saves to locations approved through
  the native dialogs. Restrict development URLs to loopback, block
  untrusted navigation, and use application settings for desktop exports.
- **Internal:** Harden Electron packaging and renderer security, and expand
  tests for the desktop shell and IPC.

## 1.0.0

- **Fixed:** Desktop modal dialogs keep `Tab` focus trapped reliably, timeline
  loop dragging clamps to live bounds without leaking listeners or map timers,
  window close guards no longer deadlock after an export finishes, canceled
  exports never overwrite finished files, and updater restart failures and
  duplicate save-picker triggers are handled cleanly.
- **Internal:** Updated `drone-path-core` and `drone-path-engine` to `1.0.0`.
