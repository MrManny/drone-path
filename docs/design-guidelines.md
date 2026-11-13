# Design guidelines: Drone Path desktop UI

Standing reference for the Electron desktop UI. Read before changing anything under `ui/`.

## Principles

1. Calm and precise. One accent, neutral surfaces, short plain sentences.
2. One primary action per surface.
3. Every state visible. Busy, waiting, canceling, disabled and failed states each show text.
4. Say what happened and what to do next. Failures read as sentences, not codes. Give actionable and constructive guidance how to resolve errors.
5. The drone footage is the hero. The video is the main pane beside a synchronized flight-map pane.

[Jakob Nielsen's 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) guide every screen.

Look and feel: layered neutral surfaces, 1 px hairline borders, one warm coral accent, 8 px and 12 px radii with pills, the Segoe UI Variable stack, icon plus label for actions (icon-only buttons carry `aria-label` and `title`).

## Color

Color tokens live in the `:root` block of `ui/app/globals.css`. The values below are the agreed reference:

| Token(s) | Value | Role |
|---|---|---|
| `--page` | `#232323` | Page background |
| `--surface-1` … `--surface-4` | `#2e2e2e`, `#363636`, `#454545`, `#525252` | Surface ladder: cards → controls → hover fill → pressed fill |
| `--bar` | `rgba(35, 35, 35, 0.94)` | Control bar over the footage |
| `--glass` | `rgba(35, 35, 35, 0.6)` | Glassy chip fill over the footage |
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

- **Accent** marks the primary action, the selected segment, a checked toggle, the playhead, the played part of the timeline and the progress fills. In the menu bar accent additionally carries menu state: the open top-level label and the hovered or keyboard-focused row (see [Menu bar](#menu-bar)). **Loop** colors mark only the loop band, its handles and the loop readout. **Warning** appears only in notices; **danger** appears in notices and on invalid fields; **danger text** colors field messages.
- **The flight trail is the accent:** `TRAIL_COLOR` in `src/renderer/theme.ts` mirrors `--accent` and derives the trail glow.
- **Warm ramp discipline:** page and surfaces stay dark neutral grays; the warm ramp is reserved for accent, loop and semantic states — never surfaces, body text or decoration.
- **Never color alone:** every state also has text — a label, `aria-invalid` with a message, or notice wording.
- **Contrast:** text needs 4.5:1 on its surface; focus, state fills and meaningful icons need 3:1. Disabled controls are exempt. `--accent-text` and `--danger-text` exist so accent- and danger-colored text can meet 4.5:1 on `--surface-1` and `--surface-2`.
- **Documented deviation — control borders (WCAG 1.4.11):** interactive-control borders measure 1.94:1 against their control fill, where non-text contrast wants 3:1. The 2026-11-13 WCAG 2.2 AA review accepted this as a design deviation: the hairline border language is deliberate, and control boundaries stay perceivable through fill contrast and layout. Do not tighten the borders toward 3:1 without a new design review.

## Player workspace

Rows are flush, one column: menu bar, header, stage, transport, timeline, and status footer.

## Menu bar

The top row of every workspace is a slim menu bar — window chrome, not a control row: 32px plus a 1px `--hairline` bottom border on `--page`, flat 14px text labels ("File" and "View" left, "Help" right) as 24px pills (`--radius-control`, 0 10px padding). It owns every workspace command; the header keeps only brand and project identity, the status footer only its status text.

Dropdowns reuse the map-popover floating-panel anatomy: `--surface-1` fill, 1px `--hairline-strong` border, `--radius-panel`, `--shadow-float`, hung directly under their label. Item rows are 32px high — a deliberate deviation from the 36px `--control-h` recipe, matching Windows menu density — borderless at `--radius-control` with 8px side padding: 16px icon, 12px gap, 14px `--text` label, right-aligned 13px shortcut hint. Separators sit on the `--hairline` tier; disabled rows use the `button:disabled` look through `aria-disabled` (the row stays focusable so the keyboard highlight is announced, see [Keyboard](#keyboard)); menus open instantly, with no motion.

**Accent's extended role: menu state color.** Per the approved "accent forward" scheme, accent marks where the user is (the open top-level label) and where they are about to go (the hovered or keyboard-focused row) — never resting rows, never decoration:

| Role | Value |
|---|---|
| Open label pill | `rgba(232, 127, 84, 0.16)` over `--page`, label in `--accent-text` |
| Hovered/keyboard-focused row fill | `rgba(232, 127, 84, 0.14)` over `--surface-1` |
| Row selection bar | `--accent`, 3×16px pill at the row's left inset |
| Icon and shortcut hint on the live row | `--accent-text` |
| Row labels (all rows) | `--text`; resting icons and hints `--text-3` |

Measured contrast (WCAG): open label 6.1:1, hover label 8.9:1, hover hint/icon 5.5:1, selection bar 4.0:1 against the row fill and 4.9:1 against the panel, resting label 11.1:1, resting hint/icon 6.0:1, disabled label 3.5:1 (WCAG-exempt). The tinted open pill measures 1.3:1 against the bar; following the tone-ladder convention, state is never a fill alone — the accent-text label carries it too.

## Keyboard

The key vocabulary lives in `ui/lib/hotkeys.ts` and is documented in
[keyboard-shortcuts.md](user/keyboard-shortcuts.md). Behavior rules: only the
arrow keys repeat when held; while a menu is open it owns the keyboard and the
player shortcuts stay inert; menus follow the Windows menu key conventions.
The menubar is one Tab stop: Left/Right move between the top-level labels,
disabled rows hold focus through `aria-disabled`, and Tab closes an open menu.

## Components, copy and errors

- **Controls:** 36px buttons and fields, 8px radii (pills for segmented groups), 1 px `--hairline-strong` borders on `--surface-2`; hover lightens, pressed darkens and shifts 1px down, `:focus-visible` shows a 2px `--focus` outline at 2px offset, disabled drops to 0.45 opacity. Exact recipes live in `ui/components/`.
- **Notices** (`Notice`, `ErrorNotice`): info, warning and danger tones over `--surface-1`, with a "Technical details" disclosure; danger is an alert, the others status messages.
- **Dialogs:** top edge 56px below the window, `--shadow-float` panel over the scrim blur; the export dialog locks dismissal while it runs. The map appearance popover is non-modal and keeps player shortcuts live.
- **Copy:** verb-first actions ("Open…", "Start export"), nouns for toggles and destinations; sentence case; American English; "…" for dialogs and work in progress; no exclamation marks; one name per action.
- **Errors:** failures read as sentences — what happened and what to do next. Node codes, stack text and paths stay under "Technical details" (`ui/lib/errortext.ts`); field validation uses "Must be {rule}.".
