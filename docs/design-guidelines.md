# Design guidelines: neo2-flightpath desktop UI

Standing reference for the Electron desktop UI. Read before changing anything under `ui/`; AGENTS.md points here. This file is the source of truth for token names, patterns, states and copy; for exact values the code is authoritative (`ui/app/globals.css` for tokens and styles, `ui/components/`, `ui/icons/`, `ui/lib/`) and wins on conflict with this file. Section 3 documents the agreed palette values. Update this file in the same pull request as any UI change.

## 1. Purpose, scope and status

- **Scope:** the app UI: landing, player (header, preview with video and flight map, transport, timeline, status bar), the map appearance popover, export and update dialogs, the help overlay, icons, copy and error text. Native OS dialogs in `app/main.mjs` are not styled here; their wording follows section 10.
- **Out of scope:** the frames and map overlay rendered by `src/renderer/` and CLI output — except the flight-trail color, which follows the app palette everywhere (section 3).
- **Tokens:** live only in the `:root` block of `ui/app/globals.css`, named by role. Components consume tokens through classes; inline styles are limited to runtime geometry (loop band and ruler tick positions, the playhead's `left`, the progress fill width, the map host's `isolation`).
- **Status:** dark theme only.

## 2. Principles and look and feel

### 2.1 Product principles

1. **Calm and precise.** One accent, neutral surfaces, short plain sentences.
2. **One primary action per surface.** The landing and the export form each have one primary button; the player bar has none.
3. **Every state visible.** Busy, waiting, canceling, disabled and failed states each show text (sections 8 and 11).
4. **Say what happened and what to do next.** Failures read as sentences, not codes (section 11).
5. **The footage is the hero.** The video is the main pane beside a dedicated, synchronized flight-map pane; Swap view turns the map into a corner overlay on the footage (section 9).
6. **No decoration that competes with the video.** Video and map never animate (section 6); the chrome has no glow, gradient or blur.

### 2.2 Usability heuristics

[Jakob Nielsen's 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) guide every screen: system status, real-world match, user control, consistency, error prevention, recognition over recall, efficiency, minimalist design, error recovery and help.

### 2.3 Look and feel

- **Direction:** dark desktop UI: layered neutral surfaces (`--page` to `--surface-4`), 1 px hairline borders, one warm coral accent (`--accent`), a sand loop color (`--loop`), 8 px and 12 px radii with pills, the Segoe UI Variable stack, icon plus label for landing, header and transport actions (the transport skips and the footer's Map settings, Swap and Help are the icon-only exceptions, §7), 140 ms motion.
- **Dark only:** `color-scheme: dark` on `html` and `body`. There is no light theme.
- **Avoid:** neon glow, decorative gradients, background textures, skeuomorphic bevels, and highlights that are not states. Inset rings mark only the loop band and invalid fields (section 6).

## 3. Color

Color tokens live in the `:root` block of `ui/app/globals.css` (section 1). The palette is Palette D variant 1 (#147); the values below are the agreed reference:

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
- **The flight trail is the accent, everywhere:** the app's map island and every rendered frame share one trail color — `TRAIL_COLOR` in `src/renderer/theme.ts` mirrors `--accent` and derives the trail glow; change the two together.
- **Warm ramp discipline:** page and surfaces stay dark neutral grays; the warm ramp is reserved for accent, loop and semantic states — never surfaces, body text or decoration.
- **Never color alone:** every state also has text — a label, `aria-invalid` with a message, or notice wording.
- **Contrast:** text needs 4.5:1 on its surface; focus, state fills and meaningful icons need 3:1. Disabled controls are exempt. `--accent-text` and `--danger-text` exist so accent- and danger-colored text can meet 4.5:1 on `--surface-1` and `--surface-2`.
- `--tone` is a local property set by `.notice-info`, `.notice-warning` and `.notice-danger`. Literal colors outside `:root`: `#000` (video and map backgrounds), `#b8b8b8` (select chevron).

## 4. Typography

- **Stacks:** `--font-ui`: "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif. `--font-mono`: ui-monospace, "Cascadia Mono", Consolas, monospace. No font file is bundled or loaded.
- **Type scale** (every size and weight in `ui/app/globals.css`): 28/600 landing title, 18/600 dialog titles, 16/600 landing primary button, 14/400 body and controls, 13/400 hints, legends and readouts, 12/400 mono details and paths.
- **Weights:** 400 and 600; 600 also on `h1`, `h2`, `button.primary`, `button.dialog-primary` and the pressed segment. Headings use `letter-spacing: -0.01em`.
- **Line height:** 1 for buttons; 1.5 for notice text, hints, landing copy and mono text.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`): readouts, number fields, the progress label and the preparation's tile count.
- **Case:** sentence case; capitals only for names and acronyms (ALT, SPD, HUD, SRT).
- **Characters:** "…" (U+2026), never three periods, for actions that open a dialog or picker (Open…, Export…) and for work in progress (Preparing…, Warming tiles…, Canceling…); "×" in sizes and speed ("1280×720", "1×"); "–" in ranges; " · " between parts of a summary; straight quotes inside error sentences.

## 5. Spacing

Spacing values are literals on this scale; use nothing else:

| Value | Used for |
|---|---|
| 2px | Speed group gap and padding |
| 4px | Legend padding |
| 8px | Gaps between controls: buttons, bar groups, dialog actions |
| 16px | Paddings and margins: buttons, fields, notices, bar sides, dialog sections |
| 24px | Dialog panel padding; landing primary padding |
| 32px | Landing card padding; room for the select chevron |
| 40px | Minimum height of a settings row |

- **Fixed sizes:** `--control-h` 36px (control height, §8.1); `--header-h` 56px, `--preview-strip-h` 40px, `--transport-h` 48px, `--timeline-h` 200px (140px below 720px window height) and `--status-h` 32px (the workspace frame, §9; mirrored by `CHROME` in `ui/lib/layout.ts`); `--dialog-top` 56px (dialog top offset, §8.5).
- **Other component sizes** (not spacing): 8px progress track; 28px dismiss and status bar button; 30px segment; 44px landing primary; 96px settings label and number field width; 4px loop handles; 2px playhead.

## 6. Shape, elevation and motion

- **Radii:** `--radius-control` 8px (buttons, fields, select, notices, dismiss); `--radius-panel` 12px (landing card, dialog panel, map card); `--radius-pill` 999px (segmented groups and segments, progress track and fill). Literals: 4px checkboxes and the loop band, 50% radios (§8.2).
- **Borders:** 1 px. `--hairline` for decorative separators; `--hairline-strong` for controls, dialogs and the map card; `--hairline-hover` on hover. Notice borders are the tone at 40%.
- **Shadows:** `--shadow-float` `0 24px 60px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35)` (landing card, dialog panel, player notices, the map appearance popover and the overlay map card). No other drop shadows.
- **Inset rings:** a 1 px inset ring marks two states only: the loop band (`--loop`) and an invalid field (`--danger`).
- **Scrim:** `--scrim` with `backdrop-filter: blur(2px)` on `.settings-overlay`. Blur belongs only behind dialogs; never on the workspace surfaces.
- **Stacking:** dialog overlay 2000; the map appearance popover 1500; player notices 3; the overlay map card 2; the map host isolates its internal layers.
- **Motion tokens:** `--motion` 140ms; `--ease` `cubic-bezier(0.2, 0, 0, 1)`.
- **What moves:** buttons, checkboxes, radios, number fields and selects transition `background-color`, `border-color`, `color`, `transform` and `opacity`; the press shift (`translateY(1px)`) moves with its button. The progress fill animates `width` over 250ms.
- **What never moves:** the map (`.scene-host` and children set `animation: none` and `transition: none`), the video, the stage panes and the view swap (instant), the header, transport, timeline and loop band, notices, and dialog open and close. The playhead and the time readouts move imperatively, without transitions. A toggle's check mark is a pseudo-element and does not transition.
- **Reduced motion:** `prefers-reduced-motion: reduce` sets `transition: none` on the transitioning controls and the progress fill; the press shift becomes instant.

## 7. Iconography

- **Style:** 24-unit grid (`viewBox="0 0 24 24"`), stroke only (`fill="none"`, `stroke="currentColor"`), stroke width 2, round caps and joins, `aria-hidden="true"`. Tests pin these attributes (`test/ui/lineicons.test.tsx`, `closeicon.test.tsx`, `settingsicon.test.tsx`).
- **Size:** every glyph carries `width="16"`; `button svg` in `ui/app/globals.css` pins the rendered size at 16px.
- **Color:** `currentColor` — the button's text color (`--text`, or `--accent-ink` on the primary and pressed segments).
- **Icon plus label** on landing, header and transport actions. Dialog footer buttons and segments ("1×", "Overview") use no glyph. The icon-only buttons — the two transport skips (Jump to start, Jump to end), the footer's Map settings, Swap and Help, and the timeline's Set loop in, Set loop out and Clear loop — carry `aria-label` and `title`.
- **Inventory:** vendored Lucide: `CloseIcon` ("x"), `SettingsIcon` ("settings"). Drawn for this app in the Lucide grid and stroke style: `PlayIcon`, `PauseIcon`, `FolderOpenIcon`, `SwapIcon`, `ExportIcon`, `MarkInIcon`, `MarkOutIcon`, `SkipBackIcon`, `SkipForwardIcon`.

## 8. Components and states

### 8.1 Buttons

- **Recipe** (`button`): inline-flex; 36px high (`--control-h`); 0 16px padding; 14px text, line height 1; 8px gap; 16px glyph; 1px `--hairline-strong` border; `--surface-2` fill; `--radius-control`.

| Variant | Selector | Difference from the recipe | Used for |
|---|---|---|---|
| Default | `button` | None | Open…, Export…, Map settings, Swap, Help, Set loop in, Set loop out, Clear loop, Jump to start, Jump to end, Cancel, Cancel export, Reveal in folder, Open video, Close, Dismiss (icon-only where §7 says so) |
| Primary, landing | `button.primary` | Accent fill, `--accent-ink` text, 600, transparent border, 44px high, 0 24px padding, 16px text | Open… on the landing |
| Primary, dialog | `button.dialog-primary` | Accent fill, `--accent-ink` text, 600, transparent border; default size | Start export; Restart now |
| Segment | `.segmented button.segment` | Transparent fill, no border, 30px high, 0 8px padding, pill | 1×, 2×, 3×, 4×; Overview, Follow |
| Dismiss | `.notice-dismiss` | 28px high, 0 8px padding | Dismiss in notices |
| Status bar | `.status-bar button` | 28px high, 0 8px padding | Map settings, Swap, Help (icon-only, §7) |

- **States:** hover lightens (`--surface-3` fill and `--hairline-hover` border; `--accent-hover` fill on primaries; `--surface-3` on segments), pressed darkens (`--surface-4` fill, `--accent-press` on primaries) and shifts 1px down (segments only shift), `:focus-visible` shows a 2px `--focus` outline at 2px offset, and disabled drops to `--disabled-opacity` 0.45 with the default cursor and no hover or pressed change.

### 8.2 Toggles

- Checkboxes and radios are custom: 16px box, `--surface-2` fill, 1px `--hairline-strong` border; checkbox radius 4px, radio 50%. Checked: `--accent` fill and border with the check mark or dot in `--accent-ink`. Unchecked hover: `--hairline-hover` border. Disabled: 0.45 opacity. Each sits in a `label.settings-row` with its text.
- HUD chips are checkboxes. "Altitude (ALT)" is disabled, with the title "Altitude unavailable in this telemetry", when the recording has no altitude. The export "What" choice uses radios.
- **Segmented choice:** `.segmented` is a pill group (`role="group"` with a name) of `.segment` buttons marked with `aria-pressed`; it carries playback speed and the View choice.

### 8.3 Notices

- One component, `Notice` (`ui/components/Notice.tsx`), props `tone` (`info`, `warning`, `danger`), `details`, `onDismiss`. It renders `notice notice-{tone}`: 16px padding, 8px gap, 8px radius, an 11% tone tint over `--surface-1`, and a 40% tone border.
- **Error notices** go through `ErrorNotice` (`ui/components/ErrorNotice.tsx`), props `message`, `lead`, `tail`, `onDismiss`: it runs the message through `describeError()` (section 11) and renders `Notice tone="danger"`, so every failure surface assembles the same pipeline.
- Text 14px, line height 1.5. Details: a "Technical details" disclosure with the original text in 12px mono. Roles: `danger` is `alert`; `info` and `warning` are `status`.

| Tone | Used for |
|---|---|
| `info` | Open preparing; no recording picked; export summary; export canceled |
| `warning` | Map appearance: no altitude telemetry, so the ALT chip stays off |
| `danger` | Open failed; export could not start; export failed; reveal or open failed; cancel failed |

- **Placement:** landing, below Open… (16px top margin). Player: a centered overlay at the top of the stage (16px from the top, at most 560px wide, z-index 3, `--shadow-float`), showing only Open preparing and Open errors; the warm hint chip (section 8.6) shares that overlay column. Dialogs: above the footer on the export form and while running; under the title in the done, canceled and error phases, and in the update prompt. In the export dialog all of these sit in the phase column (§8.5). Map appearance popover: inside the HUD chips group.
- **Dismissible:** only when the owner passes `onDismiss`; today only Open errors are. Notices that describe a state clear when the state changes. Export form errors clear on the next form edit or start; action and cancel errors clear on the next attempt or when the job settles (`ui/lib/exportstate.ts`).

### 8.4 Fields

- **Settings row:** label (`label.settings-label`, 96px, `--text-2`), control (36px high, `--surface-2`, 1px `--hairline-strong` border, 8px radius, 0 16px padding, 14px text), and one helper slot holding the hint (`.hint`, 13px, `--text-3`) or the message (`.field-message`, 13px, `--danger`).
- **Number field** (`NumberField`): 96px wide, tabular numerals, `min` and `step` props (step 1; 0.5 for Intro and Outro). A valid value applies at once. A value that is not finite, is below `min`, or fails the owner's check is rejected: the typed text stays, `aria-invalid="true"` is set, the border turns `--danger` with a 1px inset ring, `aria-describedby` points at the message, and the message replaces the hint: "Must be {rule}." Rules in use: "0 or more", "at least 64 px". On blur the typed text is dropped and the last valid value shows.
- **Export dimensions** (Width and Height in the export "How" group): the commit applies the pipeline's own rule (`normalizeDimensions`, `src/config.ts`), so the field always shows the effective even size (each rounded down, minimum 64) the export renders — typing 769 and blurring shows 768. Rejected input (below the minimum, non-finite) behaves as in the Number field rule above.
- **Select** (`SelectField`): a native `select` styled as a field (`appearance: none`, 32px right padding, chevron as background image). Options show plain labels; the raw vocabulary value is what applies.
- **Groups:** `fieldset.settings-group` with a 13px `legend` in `--text-3`: "HUD chips"; "What" and "How" in export, where the "How" legend appears only beside "What" — a lone group carries no legend. In export, the "What" radios sit in card rows (`.export-choice`: `--surface-2` fill, `--hairline-strong` border, `--radius-control`, 8px apart, `--hairline-hover` border on hover; the checked radio carries the accent), and "How" runs the output-size fields (Width, Height) above the encoding selects (Format, Quality, Speed), the blocks 16px apart (`.export-encode`).

### 8.5 Dialogs

- **Anatomy:** overlay `.settings-overlay`; panel `.settings-panel` (`role="dialog"`, `aria-label` "Export" or "Update"); header `.settings-header` (18px title and the header close); body; footer `.dialog-actions` (right-aligned, wrapping, 8px gap, 16px top margin), export and the update prompt. The export form's encoder choices (Format, Quality, Speed) apply and store on change (a fresh install, or state the app cannot read, starts at the documented defaults). The export body (`.export-body`) is two columns — the output preview (§ below) beside the phase column (`.export-phase`) — and collapses to the phase column alone in the canceled and error phases.
- **Position and size:** the top edge sits 56px (`--dialog-top`) below the window top in every phase. The panel is `min(440px, 100%)` wide (`min(720px, 100%)` in the export dialog, `.export-panel`), padded 24px, at most `100vh − 80px` high, and scrolls inside.
- **Export output preview** (`.export-preview`): the caption row ("Output preview", 14/600; the committed output size "1280×720", 13px `--text-2`, tabular), the frame (`.export-preview-frame`) at exactly the output's aspect ratio and at most 300px tall — black background, `--hairline-strong` border, `--radius-panel` — and the note "Export renders the map, not the source video." (13px `--text-3`). The frame carries the shared map scene planned at the output size, held on the mid-frame of the export selection: the map-only output, with no footage anywhere in the dialog. The preview shows in the form, running and done phases (the frozen request's look while a job runs) and drops out for canceled and error, which are notice-only.
- **Header close** (`DialogClose`): always present, labeled "Close" with a glyph. While closing would interrupt work it is disabled, and its `title` gives the reason: "Export is running. Cancel it to close."
- **Footer by phase** (export):

| Phase | Footer | Notice |
|---|---|---|
| Form | Cancel (closes); Start export (primary) | Danger, for a start or file error |
| Running | Cancel export (disabled while canceling) | Progress above; danger when a cancel fails |
| Done | Reveal in folder; Open video; Close | Info summary; output path above; danger when a reveal or open fails |
| Canceled | Close | Info |
| Error | Close | Danger; ends "The destination file was left untouched." |

- **Export form memory:** the form opens on the In–Out segment when a loop is engaged, and remembers the output size for the session (a new recording starts from the resolved size).
- **Escape and backdrop:** Export closes on Escape, backdrop click or header Close only when not running; while running they are ignored. One rule drives all three, from the dialog visibility state (`ui/lib/dialogstate.ts`): the export modal reports its job's start and finish there, and the header close and backdrop read the dismissal rule back.
- **Lock while busy:** during an export the header close is disabled, and closing the window asks "An export is in progress" (native prompt, `app/main.mjs`). Cancel export is the only way out.
- **Update prompt:** titled "Update"; its message is the info notice under the title, and its footer carries Later and Restart now (primary). Escape, the backdrop and the header close all mean Later. When the restart starts every dismissal locks too: the primary reads "Restarting…" and the header close is disabled with "The app is restarting." If the restart cannot start, the prompt unlocks and offers Restart now again. The prompt appears at most once per session and only over a quiet UI: never over another dialog or a running export.
- **Shortcuts:** while a dialog is open, player shortcuts are off; only Escape reaches the dialog logic (section 13). The map appearance popover (§8.8) is not a dialog: shortcuts stay live while it is open, and Escape closes it instead of clearing the loop.

### 8.6 Progress

- **Determinate:** one component, `ProgressBar` (`ui/components/ProgressBar.tsx`), carries the pattern: `.progress-track` (8px high, `--surface-2`, pill) holds `.progress-fill` (`--accent`, width = rounded percent). `role="progressbar"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` = the percent; the `aria-label` names the work ("Export progress", "Preparation progress").
- **Export:** the label below (13px, `--text-2`, `.progress-label`) reads "Rendering 83%" from typed capture-progress events (`CaptureProgress` done/total counts, `ui/lib/exportstate.ts`).
- **Loading:** while a recording is prepared, the bar sits above the status notice (`.prepare-status`, 8px gap) on the landing card and in the player's Open overlay. Steps: one per preparation stage (probe → telemetry → view plan) and one per tile the preparation waits for — 3 + tile count steps in all (`PrepareProgress`, `src/run.ts`). The desktop app waits for the gate tiles only (the tiles the first frame shows: the pane's window at the intro's zoomed-out start around the drone's first position, with the 9 nearest displayed tiles as a floor; `gateTiles`, `src/plan.ts`), so every gate tile (downloaded, cached or failed) advances the bar and it fills completely exactly when the player opens; the CLI render pipeline waits for every planned tile so rendered frames never fall back to placeholders. The notice names the running stage: "Probing the recording…" (probe), "Loading telemetry…" (telemetry), "Planning the view…" (view plan), "Warming tiles… 12/20" (tile pre-warm, with the running count; `ui/lib/preparetext.ts`).
- **Warm hint:** after the switch, the remaining tiles the map displays stream into the cache in the background and a small status chip (`.warm-hint`, `ui/components/WarmHint.tsx`) keeps the count over that plan ("Warming tiles… 12/48") in the player's top-center overlay column. It is an overlay: it takes no layout space from the map or the video, and it disappears when the last tile settles. A map style, zoom, view or window-size change re-plans the map and pivots the stream onto that plan — downloads still running for the old plan are dropped, the count restarts and already-cached tiles count at once. On-demand tile fetches always take priority over the pre-warm, and both lanes share the 2.0 req/s budget.
- **Unknown amount:** no indeterminate bar exists. The export label reads "Preparing…" and the fill stays at 0%; while canceling it reads "Canceling…".
- **Busy controls:** the landing Open… reads "Preparing…" and is disabled while the recording is prepared; the player's Open… is disabled; Play is enabled as soon as the player opens (the gate warmed what the first frame shows), with "Warming tiles…" covering only the beat before the map attaches.

### 8.7 Help

- The help overlay renders the user manual (`docs/user/*.md`, compiled into the UI export): dialog anatomy in a wide panel, opened from the landing and the status bar ("Help"), dismissed like the dialogs (Escape, backdrop, header close).
- **Panel:** `.help-panel` widens the dialog panel to `min(880px, 100%)`; every other panel rule follows section 8.5 (56px top offset, 24px padding, scrolls inside).
- **Body:** `.help-body` places the `.help-nav` page list (200px, derived from the manual index) beside the `.help-content` article. The nav stays in view while the page scrolls (sticky at the scrollport top; an overflowing index scrolls inside the nav). The current page is `aria-current="page"` in `--accent` on a `--surface-2` fill; nav links are text links without underline.
- **Content:** compiled GitHub Flavored Markdown renders as prose: headings 18px/16px/14px at 600, body 14px at 1.5 line height, links in `--accent` (underlined), inline and block code in `--font-mono` 12px on `--surface-2`, tables with hairline borders and 8px cells, images full-width with a hairline border and 8px radius; an image caption stands as one italic paragraph under it.
- Internal links navigate in place and scroll to their heading anchor; web links open in the system browser (the window-open handler in `app/main.mjs`).
- Help is fully offline: pages and images are compiled into `ui/out`, nothing is fetched at runtime.

### 8.8 Map appearance popover

- A non-modal popover anchored above the footer's Map settings button (`aria-expanded`): `.map-popover` (`role="dialog"`, `aria-label` "Map appearance", 16px padding, `min(360px, 100%)` wide, scrolls inside, z-index 1500 under dialogs). No scrim and no focus trap; player shortcuts stay live while it is open.
- **Anatomy:** the header (18px title and the `DialogClose` "Close"), the description line ("Customize how your flight path appears in the preview and map export."), the Map group (Map style, View, Zoom, Zoom-out, Intro (s), Outro (s)), the HUD chips group with the no-altitude warning notice (§8.2/§8.3), and the "Map-only export" note ("Export renders the map, not the source video.").
- **Behavior:** every change applies at once and is stored like the rest of the look settings. The popover opens focused and returns focus to the Map settings button when it closes. Escape, a click outside or Close dismiss it; Escape reaches it before the loop shortcut (section 13). The open state is session-only. This panel replaces the former Settings dialog; its fields keep the field recipes of §8.4.

## 9. Layout and responsiveness

- **Window:** default 1600×950; minimum 1024×600 (`app/main.mjs`).
- **Landing:** card at most 560px wide, 32px padding, 12vh top margin, centered.
- **Review workspace:** one column — header bar (`--header-h`), preview area (label strip `--preview-strip-h` and the stage), transport row (`--transport-h`), timeline panel (`--timeline-h`, 140px below 720px window height) and status bar (`--status-h`). The chrome heights mirror `CHROME` in `ui/lib/layout.ts`; change the two together.
- **Header bar:** wordmark "neo2 / flightpath", divider, the project slot ("Flight workspace", "Recording · 0:34"), spacer, then Open… and Export…. Gaps 8px; padding 0 16px.
- **Preview area:** the label strip ("Preview" · "Video + map"; the "Paused at 0:10" / "Playing at 0:10" state tag) over the stage.
- **Stage, split (default):** the video pane (flex, `object-fit: contain`, black letterbox) beside the map card rail — `clamp(280px, 28%, 372px)` wide, 16px padding and gap: the "Flight map" header with the "Satellite · Overview" look summary, the map host (fills), the "Current position" readout and the shared-playhead note. Below 720px window height the card drops the readout and the note so the map host keeps room for the HUD chips and the attribution.
- **Stage, overlay:** the map becomes a square corner card on the footage — `clamp(180px, 36%, 242px)`, 18px from the right and bottom edges — with the "Map" tag; the card's header, readout and note hide. Swap view (or S) exchanges the two layouts; the map island stays mounted across the swap.
- **Transport row:** Jump to start, Play/Pause and Jump to end at the left, a divider, the position readout; "Playback speed" with the segment group at the right.
- **Timeline panel:** a flush surface — full window width, square corners, no border, meeting the status bar — with its content padded 16px: the header ("Timeline"; the icon-only Set loop in, Set loop out and Clear loop; the loop readout), the time ruler (ticks from `timelineTicks`, §12), and the video track: the filmstrip (decorative) as one continuous, borderless strip below the ruler — no track-label column — with the loop band with draggable ends (pointer only; the keyboard path is I/O, Esc and the buttons), the playhead and the range slider "Playback position" over the track. The ruler shares the strip's exact span, so its ticks line up with the band and the playhead. The map's telemetry is not a timeline lane.
- **Status bar:** readiness, "SRT telemetry loaded" (only with telemetry) and the duration at the left; the icon-only Map settings, Swap and Help at the right.
- **Dialogs:** `min(440px, 100%)` wide (`min(720px, 100%)` for the export dialog); top offset 56px (§8.5). The map appearance popover anchors above the footer's Map settings button (§8.8).

## 10. Copy and labels

- **Rules:** verb-first actions ("Open…", "Start export", "Cancel export", "Reveal in folder"); nouns for toggles and destinations ("Map settings", "Swap"); short phrases for status ("Preparing…", "Warming tiles…", "Canceling…"). Sentence case. American English ("canceled", "Canceling…"). No exclamation marks.
- **App title:** "Neo2 Flightpath" in the window title bar — the `metadata` title in `ui/app/layout.tsx`; `app/main.mjs` carries the same string for the pre-load frame.
- **One name per action:** "Open…" on the landing and the player; "Export…" in the bar opens the dialog titled "Export"; the footer's Map settings opens the popover titled "Map appearance".
- **Ellipsis:** verb-first actions that open a dialog or picker, and work in progress (section 4). **Shortcuts** go in parentheses in the `title`: "Set loop in (I)".
- **Raw identifiers** belong under "Technical details" or in the CLI, never in main UI text.

| Where | Labels |
|---|---|
| Landing | Open…, Preparing…, Help |
| Workspace header | Flight workspace; Recording · 0:34; Open…, Export… |
| Preview strip and map card | Preview · Video + map; Paused at 0:10 / Playing at 0:10; Flight map; Satellite · Overview; Map; Current position 0:10 / 0:34; "Map and video share the same playhead." |
| Transport | Play / Pause / Warming tiles…, Jump to start, Jump to end (`aria-label`; `title` "Jump to start (Home)" / "Jump to end (End)"), Playback speed (1×, 2×, 3×, 4×) |
| Timeline | Timeline; the icon-only Set loop in / Set loop out / Clear loop (`title` "Set loop in (I)" / "Set loop out (O)" / "Clear loop (Esc)"); loop 0:10–0:12 |
| Status bar | Ready / Preparing…, SRT telemetry loaded, 0:34 duration, Map settings, Swap, Help (icon-only; `title` "Swap (S)") |
| Preparation status | Probing the recording…, Loading telemetry…, Planning the view…, Warming tiles… 12/20 (running tile count over the awaited tiles) |
| Warm hint | Warming tiles… 12/48 (running tile count over the tiles the map displays) |
| Export dialog | Start export, Cancel, Cancel export / Canceling…, Reveal in folder, Open video, Close; progress "Rendering N%" / "Preparing…"; preview "Output preview" and the size "1280×720", with the note "Export renders the map, not the source video." |
| Export "What" | Full recording (0:34); In–Out segment (0:10–0:12 · 121 frames) — shown only when a loop is set |
| Export "How" | Width, Height; hint "px"; message "Must be at least 64 px."; Format (H.264, H.265), Quality (Near-lossless, High, Medium, Low), Speed (Balanced, Faster) |
| Map appearance popover | Map appearance; "Customize how your flight path appears in the preview and map export."; Map: Map style (Satellite, Topographic; hint "Satellite imagery"), View (Overview, Follow; hint "Camera framing"), Zoom (hint "0 = auto-fit"), Zoom-out (hint "auto-fit only"), Intro (s), Outro (s); HUD chips: Heading arrow, Altitude (ALT), Speed (SPD); Map-only export — "Export renders the map, not the source video." |
| Update dialog | Update (title); Restart now, Later / "Restarting…"; message "A new version is ready to install. Restart now to finish updating, or keep working and the update installs when you quit." |
| Notices | Dismiss; "Technical details" |

## 11. Error guidance

- **Flow:** the owning component renders `ErrorNotice` (`ui/components/ErrorNotice.tsx`) with the raw backend or Node message; it runs `describeError()` (`ui/lib/errortext.ts`), which yields `{ text, technical }`, and renders `Notice tone="danger"`: `text` is the main line; `technical` sits under "Technical details". Open errors pass `lead` "Could not open the recording:"; the export error phase passes `tail` "The destination file was left untouched."
- **Mapping:** (1) a message that starts with a Node code (`EEXIST`, `ENOENT`, `EACCES`, `EPERM`, `ENOSPC`, `EBUSY`, `EISDIR`) becomes "{what happened} {what to do}", naming the file when the message ends with a quoted path; (2) one of 13 known app messages becomes its sentence; (3) any other message passes through unchanged as the main line, with no technical text.
- **Sentence pattern:** what happened, in plain words with the cause when known, then what to do next. The original message always sits under "Technical details":

| Message in | Main line shown |
|---|---|
| `not a readable .mp4 file: <path>` (Open) | Could not open the recording: "<name>" is not a readable .mp4 recording. |
| `EEXIST: file already exists, mkdir '<path>'` (export) | A file named "<name>" is in the way. Choose another folder or file name. The destination file was left untouched. |
| `ENOSPC: …` | The disk is full. Free some space or choose another drive. |

- **Tones:** danger when an action failed and the user must act; info for a neutral result or progress; warning when the result stands but something is missing or limited.
- **"Left untouched":** only for export outcomes — true because the export writes a `.partial` file beside the destination and replaces it only after verification (`src/exportjob.ts`). Never use it for Open errors.
- **Never in the main line:** Node codes, stack text, or a path other than a file name — except the kept render, which the user must open.
- **Adding a message:** map it in `ui/lib/errortext.ts`, add a test in `test/ui/errortext.test.ts`, choose a tone, follow the pattern. Field validation is not error text; it uses "Must be {rule}.".

## 12. Numbers and formats

- **Frame rate:** `formatFrameRate` (`ui/lib/framerate.ts`) turns a rational rate into decimal fps rounded to hundredths, with " fps" (60000/1001 → "59.94 fps").
- **Time:** `formatTime` (`ui/lib/frametime.ts`) gives m:ss from whole seconds, rounded, with no hour field. Readout "0:00 / 0:34"; loop readout "loop 0:10–0:12" ("?" for an unset point); segment "0:10–0:12 · 121 frames" (frames = out − in + 1). The timeline ruler's ticks come from `timelineTicks`: the whole-second step that keeps the tick count near six, always starting at 0 and ending at the duration.
- **Frames and seeks:** displayed time is frame index ÷ fps; seeks land mid-span at (frame + 0.5) ÷ fps so a presented time quantized to microseconds can never settle on the neighboring frame; a one-second jump is `round(fps)` frames (`framesForSeconds`).
- **Export summary:** "{frames} frames @ {fps} · {seconds} s · {width}×{height}". Seconds are whole; width and height are the even sizes rendered (each rounded down, minimum 64) and equal the sizes the fields committed (§8.4), so the summary never diverges from the dialog. Dimensions are px, minimum 64 (`MIN_DIMENSION`, `src/config.ts`).
- **Percent:** whole percent, rounded ("Rendering 83%"). **Units:** px, s, m, fps; speed uses "×". **Numerals:** tabular for readouts, number fields and the progress label; decimal point "."; " · " between parts; "–" for ranges; "×" for sizes and speed.

## 13. Accessibility

- **Focus:** `:focus-visible` shows a 2px `--focus` (white) outline, offset 2px, on buttons, inputs (including toggles and the timeline), selects and summaries. Mouse clicks do not show it. Opening a dialog moves focus to its panel (`tabIndex={-1}`); closing returns it to the opener.
- **Contrast:** every text token meets 4.5:1 on each surface where it is used; the accent, focus ring and state fills meet 3:1 (section 3).
- **Names:** icon-plus-label buttons have visible text; Close also sets `aria-label`; the icon-only buttons (Jump to start, Jump to end, Map settings, Swap, Help) carry `aria-label` and `title`; loop buttons set `aria-label` and a `title` with the key; the timeline slider has `aria-label` "Playback position"; dialogs have `role="dialog"` and an `aria-label`, and so does the map appearance popover, whose toggle sets `aria-expanded`; the progress bar has `role="progressbar"` and a label; fields use `label` with `htmlFor`; groups use `fieldset` and `legend` (a lone export group carries none, §8.4); segments use `aria-pressed` in a group labeled "Playback speed" or "View"; the export output preview is named by its caption row ("Output preview" and the output size).
- **Disabled reasons:** the visible label when it states the reason ("Preparing…", "Warming tiles…", "Canceling…") or a `title`: the header close during an export ("Export is running. Cancel it to close."), the altitude toggle, and Clear without a loop ("No loop to clear.").
- **Keyboard** (`ui/lib/hotkeys.ts`, `ui/hooks/usePlayerHotkeys.ts`): Space or K play and pause; 1–4 set speed; Home and End seek; I and O set loop points; S swaps the stage layouts; Left and Right step one frame; Shift with Left or Right jumps one second; Ctrl+O opens a recording; Escape closes the open dialog or the map appearance popover, or clears the loop when none is open, and does nothing while an export runs. Shortcuts are off in text fields, selects and text areas, and while a dialog is open (only Escape gets through). Space is also off over a focused button, link or disclosure, which it activates instead. Only the arrow keys repeat when held.
- **Motion:** reduced motion removes all transitions; video and map never animate (section 6).
- **Announcements:** danger notices are alerts; info and warning notices are status messages, and so is the warm hint. The progress bar exposes `aria-valuenow`.
- **Text size:** the smallest text is 12px (mono details and paths); body text is 13–14px. Sizes are fixed in px and do not follow a system text-size setting.
