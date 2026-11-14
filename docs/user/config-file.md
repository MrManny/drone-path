# Config file

## Discovery

Options can live in a `.dronepath.json` file, discovered upward from the working directory, or in a file named explicitly with `--config <path>`.

## Keys

All keys are optional: anything omitted falls back to the default listed in [CLI and config reference](cli-reference.md). Precedence is CLI flags over config-file values over built-in defaults. The checked-in `.dronepath.example.json` is a complete example.

The `trailColor` key takes the same RGB or RGBA hex value as `--trail-color` and may be `null` to keep the map style's own trail color. The long-removed `trail` key stays rejected.

The `trackOut` key is the config-file spelling of `--track-out`: one flight track file path whose extension picks the format. The `telemetryJson` key is its deprecated alias (same output as a `trackOut` ending in `.json`, warns on use, removed in a future version). Both spellings normalize to one option, so mixing them in one run is an error — in the file, on the command line, or across both.
