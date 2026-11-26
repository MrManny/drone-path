# Keyboard shortcuts

The review player in the desktop app is fully keyboard-operable, including the menu bar.

| Keys | Action |
|---|---|
| `Space` / `K` | Play or pause |
| `1` `2` `3` `4` | Playback speed 1x, 2x, 3x, 4x |
| `Left` / `Right` | Step one frame |
| `Shift+Left` / `Shift+Right` | Jump one second |
| `Home` / `End` | Jump to the start / end |
| `I` / `O` | Set the in / out point |
| `Esc` | Close the open menu or dialog, or clear the in and out points |
| `P` | Switch the map into picture-in-picture mode and back |
| `+` / `-` | Zoom the map in / out one level and pin it as the [zoom level](desktop-app.md#map-appearance); the character and numpad keys both work |
| `Ctrl+O` | Open a recording — works in the empty workspace and while typing |

## Menu bar

The menu bar at the top of the workspace follows the Windows menu conventions:

| Keys | Action |
|---|---|
| `Alt` | Open the menu bar (File first), or close it again |
| `Alt+F` / `Alt+V` / `Alt+H` | Open the File / View / Help menu |
| `Up` / `Down` | Move through the open menu's items |
| `Left` / `Right` | Move between the menus |
| `Enter` / `Space` | Activate the highlighted item |
| `Tab` | Close the menu and move on |
| `Esc` | Close the menu without running anything |

## How shortcuts behave

- Before a recording is loaded, the playback shortcuts do nothing; `Ctrl+O` still opens one.
- Shortcuts are inert while a text field, select or other editable control has focus, but stay live over non-text controls like the timeline scrubber. `Ctrl+O` and `Esc` are the exceptions: they also work while typing.
- `Space` leaves activation to a focused button, link or disclosure instead of toggling playback.
- `Left`, `Right`, `Home`, and `End` yield to the focused **Archive | Review** header tabs to switch workspace modes instead of stepping frames or seeking playback.
- While a menu is open it owns the keyboard: the player shortcuts wait until it closes.
- While a dialog is open, only `Esc` works: it closes the dialog. This includes **Map appearance** — the dialog is modal, so the player shortcuts pause while it is open and keystrokes in a field never move the player.
- The first `Esc` over a focused select closes its dropdown; the next one closes the dialog, or clears the in and out points, as from anywhere else.
- The In–Out segment's edge handles on the timeline are a pointer-only enhancement: with the keyboard, set the points with `I` / `O` or the in/out-point buttons in the timeline header.
- One point is enough to mark a passage: `I` alone plays to the end of the recording, `O` alone from its start. Setting a point past the other replaces it, so the in point always stays before the out point.
- Held keys auto-repeat only for stepping and jumping; every other shortcut acts once per press.

## Archive workspace

The [Archive workspace](archive.md) supports keyboard navigation in the header tabs, recording list, and point-query popover:

| Keys | Action |
| --- | --- |
| `Left` / `Right` | Switch between the focused **Archive** and **Review** header tabs |
| `Home` / `End` | Jump to the **Archive** / **Review** header tab when tabs are focused |
| `Up` / `Down` | Move focus and selection through recordings in the Archive clip list |
| `Enter` / `Space` | Open the focused recording in Review (when online) or activate the focused control |
| `Esc` | Close the **Clips at this spot** point-query popover or an open dialog |
