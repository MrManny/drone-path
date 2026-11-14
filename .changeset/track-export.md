---
"drone-path": minor
---

Flight track files: `--track-out <file>` writes the decoded flight track in the
format the file extension picks — GPX (`.gpx`), GeoJSON (`.geojson`), KML/KMZ
(`.kml`/`.kmz`), or the existing telemetry JSON document (`.json`, unchanged
bytes). Vertices sit at decoded GPS fixes with telemetry gaps breaking the
line, altitude is the absolute/GPS altitude in meters above mean sea level,
and times appear only where a recording carries trustworthy UTC — none does
today (the CAM-meta device timestamp counts since power-up), so KML exports
plain line segments instead of a timed flythrough. `--telemetry-json <file>`
is a deprecated alias of `--track-out <file>.json`: same output, warns on use,
removed in a future version; mixing the two spellings in one run — in the
config file, on the command line, or across both — is an error. The desktop **Export telemetry…** dialog offers the same five formats and honors
the In–Out range; for the same recording and range the app and the CLI write
byte-identical files. A frame range of a single frame (start = end) is now
valid everywhere ranges are accepted.
