# Config file

## Discovery

Options can live in a `.neo2flightpath.json` file, discovered upward from the working directory, or in a file named explicitly with `--config <path>`.

## Keys

All keys are optional: anything omitted falls back to the default listed in [CLI and config reference](cli-reference.md). Precedence is CLI flags over config-file values over built-in defaults. The checked-in `.neo2flightpath.example.json` is a complete example.
