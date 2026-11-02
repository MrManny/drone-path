<!-- Generated from the option vocabulary in src/config.ts by "npm run docs:reference". Do not edit by hand. -->

# CLI and config reference

Every `neo2-flightpath` option with its config-file key and built-in default.
In a [config file](config-file.md) every key is optional: anything omitted
falls back to the default below. Run `npx neo2-flightpath --help` for the same
table in the terminal.

| Config key | CLI flag | Default | Description |
|---|---|---|---|
| `outDir` | `--out-dir <dir>` | `out` | output folder |
| `outSuffix` | `--out-suffix <suffix>` | `_map` | output name = &lt;basename&gt;&lt;suffix&gt;.mp4 |
| `width` | `--width <px>` | `768` | canvas width in pixels (rounded down to even) |
| `height` | `--height <px>` | `768` | canvas height in pixels (rounded down to even) |
| `style` | `--style <name>` | `satellite` | map look (choices: satellite, topo) |
| `view` | `--view <mode>` | `follow` | follow: drone stays centered and the map slides under it; overview: static whole-track map (choices: follow, overview) |
| `zoom` | `--zoom <n>` | `0` | fixed view zoom level (0 = auto-fit to the track) |
| `zoomOut` | `--zoom-out <n>` | `1` | auto-fit only: pull back n zoom levels |
| `introSec` | `--intro-sec <s>` | `2` | intro: zoom in from one level out over s seconds |
| `outroSec` | `--outro-sec <s>` | `2` | outro: zoom back out over s seconds |
| `hud` | `--hud <list>` | `heading` | comma list of heading,alt,speed - or none (alt hides when unavailable) |
| `workers` | `--workers <n>` | `4` | parallel browser pages |
| `capture` | `--capture <mode>` | `jpeg` | frame capture mode (canvas is parked) (choices: jpeg, png) |
| `preset` | `--preset <name>` | `medium` | x264 preset (choices: medium, veryfast) |
| `tileCache` | `--tile-cache <dir>` | — | tile cache directory (default: per-user cache dir) |
| `browser` | `--browser <path>` | — | Chromium/Chrome/Edge executable (default: system Chrome/Edge) |
| `skipExisting` | `--skip-existing` | off | skip recordings whose output already exists and matches the source |
| `recurse` | `--recurse` | off | scan input folders recursively |
| `json` | `--json` | off | print one NDJSON summary line per recording on stdout |
| `quiet` | `-q, --quiet` | off | suppress progress output |
| — | `--config <path>` | — | config file (default: .neo2flightpath.json discovered upward from the working directory) |
