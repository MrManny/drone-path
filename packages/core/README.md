# drone-path-core

Extract telemetry from DJI CAM-meta streams and SRT sidecars. This package also
owns the telemetry document, frame ranges, spatial and camera-footprint math,
flight grouping, kinematic shot segmentation, launch redaction, track export
formats (`.gpx`, `.geojson`, `.kml`, `.kmz`, `.json`), and NLE timeline markers.

```sh
npm install drone-path-core
```

Use the module subpaths in Node.js 24 or later.

```js
import { parseSrt } from 'drone-path-core/srt';

const result = await parseSrt('flight.SRT');
```

Each module ships TypeScript declarations.

Install `@types/node` for your Node.js major version. In TypeScript 6, list
`node` in `compilerOptions.types` to load the Node declarations.

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "types": ["node"]
  }
}
```

Use `drone-path-archive` for library indexing and spatial search, and
`drone-path-engine` for render planning and video export.
See the [project manual](https://github.com/MrManny/drone-path/tree/main/docs/user)
for DJI input formats and telemetry details.
