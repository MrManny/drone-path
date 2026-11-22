# Tooling workspace

- Run generators from the repository root:
  - `npm run docs:reference` — generates `docs/user/cli-reference.md` from `drone-path-engine/config`.
  - `npm run docs:schema` — generates the telemetry JSON schema from `src/telemetry-json-schema.ts`.
  - `npm run build:manual` — compiles `docs/user/*.md` into the desktop app's offline help.
  - `npm run build:info` — writes build identity metadata (`src/buildinfo.ts`).

## User manual

- `docs/user/*.md` is plain GitHub Flavored Markdown rendered on GitHub and
  compiled into offline help by `src/manual/`.
- `docs/user/README.md` is the navigation index; every page must be listed there
  and start with a level-1 title.
- Use relative `.md` links with GitHub heading anchors, and reference images in
  `docs/images/` as `../images/<file>`.
- Never hand-edit `docs/user/cli-reference.md` (run `npm run docs:reference`).
- `docs/user/keyboard-shortcuts.md` must cover every key in
  `apps/desktop/ui/lib/hotkeys.ts`.
- `test/userdocs.test.ts` gates links, anchors, image references, navigation,
  track export documentation, and shortcut coverage.
