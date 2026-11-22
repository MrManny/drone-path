# drone-path-desktop

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
