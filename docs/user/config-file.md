# Config file

## Discovery

Options can live in a `.dronepath.json` file, discovered upward from the working directory, or in a file named explicitly with `--config <path>`.

## Keys

All keys are optional: anything omitted falls back to the default listed in [CLI and config reference](cli-reference.md). Precedence is CLI flags over config-file values over built-in defaults. The checked-in `.dronepath.example.json` is a complete example.

The `trailColor` key takes the same RGB or RGBA hex value as `--trail-color` and may be `null` to keep the map style's own trail color. The long-removed `trail` key stays rejected.
