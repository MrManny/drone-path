# Keyboard shortcuts

The review player in the desktop app is fully keyboard-operable.

| Keys | Action |
|---|---|
| `Space` / `K` | Play or pause |
| `1` `2` `3` `4` | Playback speed 1x, 2x, 3x, 4x |
| `Left` / `Right` | Step one frame |
| `Shift+Left` / `Shift+Right` | Jump one second |
| `Home` / `End` | Jump to the start / end |
| `I` / `O` | Set the loop in / out point |
| `Esc` | Clear the loop, or close an open dialog or popover |
| `S` | Swap the video and map layout |
| `Ctrl+O` | Open a recording — works in the empty workspace and while typing |

## How shortcuts behave

- Before a recording is loaded the playback shortcuts do nothing; `Ctrl+O` still opens one.
- Shortcuts are inert while a text field, select or other editable control has focus — but stay live over non-text controls like the timeline scrubber; `Ctrl+O` is the exception and also works while typing.
- `Space` leaves activation to a focused button, link or disclosure instead of toggling playback.
- While a dialog is open, only `Esc` works; it closes the dialog. The Map appearance popover is not a dialog — shortcuts stay live while it is open, and `Esc` closes it.
- The first `Esc` over a focused select closes its dropdown; the next one closes the dialog, popover or loop as it would from anywhere else.
- Held keys auto-repeat only for stepping and jumping; every other shortcut acts once per press.
