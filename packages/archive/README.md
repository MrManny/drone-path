# drone-path-archive

Index and query a local library of DJI drone recordings. This package owns
recording discovery, the SQLite archive store, flight grouping, spatial and
camera-gaze search, kinematic shot-segment queries, and combined HTML map and
track exports. It uses `drone-path-core` for telemetry extraction and spatial
math.

```sh
npm install drone-path-archive
```

Use the module subpaths in Node.js 24 or later.

```js
import { scanArchive } from 'drone-path-archive/indexed-scan';
import { listArchive, nearArchive } from 'drone-path-archive/query';
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

See the [project manual](https://github.com/MrManny/drone-path/tree/main/docs/user)
for archive indexing, search filters, and export formats. Install `drone-path`
for the command-line interface.
