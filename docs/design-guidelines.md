# Design guidelines: neo2-flightpath desktop UI

Standing reference for the Electron desktop UI. Read before changing anything under `ui/`; AGENTS.md points here. For exact values the code is authoritative (`ui/app/globals.css` for tokens and styles, `ui/components/`, `ui/icons/`, `ui/lib/`) and wins on conflict with this file — except that "Player workspace" below describes the polished player UI landing in parallel and wins over today's code for those items. Update this file in the same pull request as any UI change. Dark theme only.

## Principles

1. **Calm and precise.** One accent, neutral surfaces, short plain sentences.
2. **One primary action per surface.** The landing and the export form each have one primary button; the player bar has none.
3. **Every state visible.** Busy, waiting, canceling, disabled and failed states each show text.
4. **Say what happened and what to do next.** Failures read as sentences, not codes.
5. **The footage is the hero.** The video is the main pane beside a synchronized flight-map pane; Swap view turns the map into a corner overlay on the footage.
6. **No decoration that competes with the video.** Video and map never animate; no glow, gradient or blur in the chrome — the one blur allowed outside dialogs is the warm-hint chip's glass (see Player workspace).

[Jakob Nielsen's 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) guide every screen: system status, real-world match, user control, consistency, error prevention, recognition over recall, efficiency, minimalist design, error recovery and help.

Look and feel: layered neutral surfaces, 1 px hairline borders, one warm coral accent, 8 px and 12 px radii with pills, the Segoe UI Variable stack, icon plus label for actions (icon-only buttons carry `aria-label` and `title`), 140 ms motion. No neon glow, decorative gradients, textures, or highlights that are not states.

## Color

Color tokens live in the `:root` block of `ui/app/globals.css`. The palette is Palette D variant 1 (#147); the values below are the agreed reference:

| Token(s) | Value | Role |
|---|---|---|
| `--page` | `#232323` | Page background |
| `--surface-1` … `--surface-4` | `#2e2e2e`, `#363636`, `#454545`, `#525252` | Surface ladder: cards → controls → hover fill → pressed fill |
| `--bar` | `rgba(35, 35, 35, 0.94)` | Control bar over the footage |
| `--scrim` | `rgba(10, 10, 10, 0.6)` | Dialog backdrop |
| `--hairline` / `--hairline-strong` / `--hairline-hover` | `#e8e8e8` at 12% / 24% / 42% | Decorative separators / control, dialog and map card borders / hover borders |
| `--text` / `--text-2` / `--text-3` | `#e8e8e8` / 75% / 68% | Primary text / labels, readouts, paths / hints, legends, "Technical details" |
| `--accent` (hover `--accent-hover`, pressed `--accent-press`) | `#e87f54` (`#f0a967`, `#c96640`) | Primary fill, selected speed, checked toggle, played timeline range, progress fill, flight trail |
| `--accent-ink` | `#2b1207` | Text and check mark on accent |
| `--accent-text` | `#f0a967` | Accent-colored text and icons on surfaces (links, current page) |
| `--focus` | `#e8e8e8` | Focus outline |
| `--danger` / `--danger-text` | `#df5441` / `#f37d75` | Invalid fields and danger notices / field messages |
| `--warning` / `--info` | `#f0a967` / `#7fa3c4` | Warning and info notices only |
| `--loop` / `--loop-text` | `#ecc9a8` / `#f4e2d2` | Loop band and ring / loop readout |

- **Accent** marks the primary action, the selected segment, a checked toggle, the playhead, the played part of the timeline and the progress fills. It never marks loops, warnings or decoration. **Loop** colors mark only the loop band, its handles and the loop readout. **Warning** appears only in notices; **danger** appears in notices and on invalid fields; **danger text** colors field messages.
- **The flight trail is the accent, everywhere:** `TRAIL_COLOR` in `src/renderer/theme.ts` mirrors `--accent` and derives the trail glow; change the two together.
- **Warm ramp discipline:** page and surfaces stay dark neutral grays; the warm ramp is reserved for accent, loop and semantic states — never surfaces, body text or decoration.
- **Never color alone:** every state also has text — a label, `aria-invalid` with a message, or notice wording.
- **Contrast:** text needs 4.5:1 on its surface; focus, state fills and meaningful icons need 3:1. Disabled controls are exempt. `--accent-text` and `--danger-text` exist so accent- and danger-colored text can meet 4.5:1 on `--surface-1` and `--surface-2`.

## Player workspace

Rows are flush, one column: header (56px), stage, transport (48px), timeline (200px; 140px below a 720px window height) and status bar (32px). The heights mirror `CHROME` in `ui/lib/layout.ts`; change the two together. There is no preview strip above the footage: the "Preview" / "Video + map" label and the "Paused at 0:10" / "Playing at 0:10" state tag are gone, and the stage takes the space.

- **Split (default):** the video pane beside a bare map rail — no surface container (no background, border or radius), no "Flight map" heading, no look summary, no "Current position" readout, no shared-playhead note; the map fills the rail and the stage's 16px padding and gap frame it. The rail stays `clamp(280px, 28%, 372px)` wide.
- **Overlay (Swap view / S):** a square corner card `clamp(180px, 36%, 242px)`, 18px from the right and bottom edges, floating with border and shadow, with the small "Map" tag over it. Swap view exchanges the two layouts; the map island stays mounted across the swap.
- **Transport row:** Jump to start, Play/Pause ("Warming tiles…" before the map attaches) and Jump to end at the left, a divider, the position readout "0:00 / 0:34", and "Playback speed" with the 1×–4× segments at the right.
- **Status bar:** only "SRT telemetry loaded" (when the recording has telemetry) and the icon-only Map settings, Swap and Help buttons — no readiness or duration text.
- **Warm hint:** the "Warming tiles… 12/48" chip over the stage gets a glassy background — a semi-transparent fill with a backdrop blur. This is the one blur allowed outside dialogs; the scrim blur behind dialogs stays the other.

## Keyboard

Player shortcuts (`ui/lib/hotkeys.ts`): Space or K play and pause; 1–4 set speed; Left and Right step one frame, Shift jumps a second; Home and End seek; I and O set loop points; S swaps the stage layouts; Ctrl+O opens a recording; Escape closes the open dialog or the map appearance popover, or clears the loop. Only the arrow keys repeat when held.

Shortcuts are inert only while focus is in a text-entry control — text, number and search inputs, selects and text areas — and while a dialog is open (only Escape gets through). Non-text inputs like the timeline scrubber (range slider) do not swallow shortcuts. Space still yields to a focused button, link, disclosure, checkbox or radio: it activates them.

## Components, copy and errors

- **Controls:** 36px buttons and fields, 8px radii (pills for segmented groups), 1 px `--hairline-strong` borders on `--surface-2`; hover lightens, pressed darkens and shifts 1px down, `:focus-visible` shows a 2px `--focus` outline at 2px offset, disabled drops to 0.45 opacity. Exact recipes live in `ui/components/`.
- **Notices** (`Notice`, `ErrorNotice`): info, warning and danger tones over `--surface-1`, with a "Technical details" disclosure; danger is an alert, the others status messages.
- **Dialogs:** top edge 56px below the window, `--shadow-float` panel over the scrim blur; the export dialog locks dismissal while it runs. The map appearance popover is non-modal and keeps player shortcuts live.
- **Copy:** verb-first actions ("Open…", "Start export"), nouns for toggles and destinations; sentence case; American English; "…" for dialogs and work in progress; no exclamation marks; one name per action.
- **Errors:** failures read as sentences — what happened and what to do next. Node codes, stack text and paths stay under "Technical details" (`ui/lib/errortext.ts`); field validation uses "Must be {rule}.".
