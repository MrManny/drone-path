> [!NOTE]
> Head's up! This repo will be restructured as a monorepo in the near future.

# Drone Path

This handy little tool renders flight-path map videos from DJI drone
recordings (DJI Neo 2 and similar): the actual flight path on a 2D map,
ready to overlay over the drone recording.

It reads geo-coordinates from DJI's telemetry in two ways:

- the embedded CAM meta (DVTM) stream (DJI's protobuf format) is used when
  the recording has one,
- otherwise an `.SRT` sidecar next to the recording is used.

It is a CLI tool first, so agents can drive it too — that's all cool with me.
For us humans, there is a [desktop app](docs/user/desktop-app.md): pick a
recording and watch its flight path on the map in sync as you play.

## Quick start

```sh
# from GitHub
npx github:MrManny/drone-path "my-flight.mp4"

# from npm
npx drone-path "my-flight.mp4"

# topographic map, altitude + speed HUD
npx drone-path "my-flight.mp4" --style topo --hud heading,alt,speed

# flight track file alongside the render (GPX, GeoJSON, KML/KMZ or the
# telemetry JSON document, chosen by the extension; one recording per run)
npx drone-path "my-flight.mp4" --track-out "my-flight.gpx"
```

Output lands in the `out/` folder as `<basename>_map.mp4`; both the folder
and the name are configurable. Requirements: Node.js 24 or 26 and
ffmpeg/ffprobe — bundled with the desktop app and the npm package,
overridable via `--ffmpeg`/`--ffprobe`, with a `PATH` fallback. All
requirements and install options are in
[Getting started](docs/user/getting-started.md).

## User manual

The user manual lives in [docs/user/](docs/user/README.md); the desktop app
ships the same pages as offline help. Highlights:

- [Getting started](docs/user/getting-started.md) — requirements, install options, and your first render.
- [Desktop app](docs/user/desktop-app.md) — loading a recording, reviewing a flight, exporting video, and saving telemetry JSON from the app.
- [Keyboard shortcuts](docs/user/keyboard-shortcuts.md) — every shortcut of the review player at a glance.
- [CLI usage](docs/user/cli.md) — inputs, examples, and example output.
- [CLI and config reference](docs/user/cli-reference.md) — every option and config key with its default.
- [Config file](docs/user/config-file.md) — where `.dronepath.json` is found and how defaults apply.
- [Tiles and attribution](docs/user/tiles-and-attribution.md) — map sources, attribution, and tile caching.

## Desktop app

For reviewing flights without the terminal, grab the packaged desktop app
(Windows NSIS installer or portable exe, Linux AppImage) from
[GitHub Releases](https://github.com/MrManny/drone-path/releases), or run
`npm run build && npm run app` from a checkout.

The app shows the recording and the synchronized flight map side by side —
togglable to a corner map overlay — on one shared timeline;
[the manual](docs/user/desktop-app.md) walks through loading a recording,
reviewing a flight, marking a passage, exporting, and saving the per-frame
telemetry JSON. The look and language settings carry over between launches.

![Desktop app: a drone recording beside the synchronized flight map](docs/images/app-main-window.jpg)

*The desktop app playing a recording: the recording beside the synchronized
flight map, with the flight trail, drone position and the readout strip on one
shared timeline.*

## Feature requests

If you want or need specific features, feel free to open an issue in this
repository's issue tracker.

## Releasing

`npm run changeset:version` folds pending changesets and updates the lockfile.
The three npm packages and the desktop app share one version. Update the root
changelog in the release PR and use the matching `v<version>` GitHub release tag.
From an installed, built checkout, preview the release without publishing with
`node scripts/release-npm.mjs dry-run v<version>`.

A published GitHub release runs the tag and quality checks, then publishes
`drone-path-core`, `drone-path-engine`, and `drone-path` to npm in that order.
Independent jobs attach the desktop installers, AppImage, and auto-update
metadata to the same release. GitHub prereleases skip this workflow.

Reserve the release's exact package versions for GitHub Actions. To publish
the first release, set the repository's `NPM_TOKEN` secret to a granular token
authorized to create the new public package names and publish all packages in
the release. The workflow uses `--provenance` with the token.

For a manual bootstrap, use npm credentials that can create the new names.
Publish a distinct, earlier prerelease for each new name under a non-default
dist-tag such as `bootstrap` (`npm publish --workspace <name> --access public --tag bootstrap`).
npm package versions are immutable, so the workflow needs the exact release
versions to be unused.

Once each package exists, configure its
[trusted publisher](https://docs.npmjs.com/trusted-publishers/) on npm
with owner `MrManny`, repository `drone-path`, workflow `release.yml`, and
permission for direct publishing. Remove `NPM_TOKEN` when all three are
configured so subsequent releases use token-free trusted publishing.

After a partial publish, check the package versions on npm and re-run failed
jobs in GitHub Actions. Each package has its own job, so completed package jobs
keep their successful result and dependent jobs resume in order.

## License

MIT — see [LICENSE](LICENSE).
