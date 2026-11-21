# Tooling workspace

- Run `npm run docs:reference` from the repository root. The generator reads
  the engine's option vocabulary. Root `npm run build:manual` and
  `npm run build:info` refresh the desktop help and build identity.

## User manual

`docs/user/*.md` is the user manual: plain GitHub Flavored Markdown, rendered
on GitHub and compiled into the app's offline help by `packages/tooling/src/manual/`. Internal
links are relative `.md` links with GitHub heading anchors; images live in
`docs/images/` and are referenced as `../images/<file>`. `docs/user/README.md`
is the navigation index and every page must be listed there.
`docs/user/cli-reference.md` is generated (`npm run docs:reference`, never
hand-edited), and `docs/user/keyboard-shortcuts.md` must cover the key
vocabulary of `apps/desktop/ui/lib/hotkeys.ts`; `packages/tooling/test/userdocs.test.ts` gates all of this.
