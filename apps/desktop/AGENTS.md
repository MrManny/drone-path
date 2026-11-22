# Desktop workspace

- Root commands:
  - `npm run build` — creates the Next.js UI export, offline manual, and build identity.
  - `npm run app` / `npm run app:dev` — starts Electron (production export vs. dev server).
  - `npm run app:pack` — packages the desktop app. Keep FFmpeg/FFprobe binaries and their license under `resources/ff/`; see [build/README.md](build/README.md#packaging-checks) for ASAR verification.

## UI design

Before changing anything under `ui/`, read
[docs/design-guidelines.md](../../docs/design-guidelines.md), the source of truth
for UI tokens and design principles.

## Desktop localization

- Catalogs live in `shared/desktop-i18n/catalogs/` with English in `en.json`. Call
  `t('area.message')` with a literal key in React or the Electron main process.
- Pass named values for `{placeholders}`. For plurals, use an object of
  locale-specific plural categories with a required `other` form and pass a
  numeric `count`. Translate complete phrases rather than concatenating fragments.
- To add a language, add `<locale>.json` named for its canonical BCP 47 tag
  (for example, `es.json`) with every English key and placeholder; the build
  discovers it automatically and `npm test` verifies coverage and parameters.
- When copy grows, check settings, dialogs, and playback readouts at the default
  and minimum window sizes. Keep shared diagnostics and the offline manual in
  English.
