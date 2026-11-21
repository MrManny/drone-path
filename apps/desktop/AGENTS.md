# Desktop workspace

- From the repository root, `npm run build` creates the UI export and build
  identity. Run `npm run app` to start Electron or `npm run app:dev` to start
  Electron with the development server.
- Run `npm run app:pack` from the repository root to package the desktop app.
  Keep the FFmpeg and FFprobe binaries and their license under `resources/ff/`.
  See the [packaging checks](build/README.md#packaging-checks) for ASAR
  dependency verification.

## UI design

Before changing anything under `ui/`, read
[docs/design-guidelines.md](../../docs/design-guidelines.md), the source of truth for
UI tokens and design principles.

## Desktop localization

- Desktop catalogs are in `src/desktop-i18n/catalogs/`. Keep the English copy in
  `en.json` and call `t('area.message')` with a literal key in React or the
  Electron main process. Provide named values for `{placeholders}`. For
  plurals, use an object of locale-specific plural categories with a required
  `other` form, and pass a numeric `count`. Translate complete phrases so
  translators can choose the word order and punctuation.
- To add a language, add a JSON catalog named for its canonical BCP 47 locale
  (for example, `es.json`). The build discovers the catalog and the app uses
  the locale's own language name in Settings. Include every English key and
  retain its placeholders. `npm test` checks catalog coverage and parameters.
- Propose a translation correction with a catalog PR or an issue that names
  the language and screen and includes the current and proposed wording.
  Check settings, dialogs and playback readouts at the default and minimum
  window sizes when copy grows. Keep shared diagnostics and the offline manual
  in English.
