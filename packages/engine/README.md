# drone-path-engine

Plan and render flight-path map overlay videos from DJI recordings. This
package owns the render pipeline and configuration. It uses
`drone-path-core` for telemetry extraction and track export.

```sh
npm install drone-path-engine
```

Use the module subpaths in Node.js 24 or later.

```js
import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import { runBatch } from 'drone-path-engine/pipeline';
```

Each module ships TypeScript declarations. Install `@types/node` for your
Node.js major version and use a module resolution mode that reads package
exports, such as `NodeNext`.

See the [project manual](https://github.com/MrManny/drone-path/tree/main/docs/user)
for browser, FFmpeg, and map tile requirements. Install `drone-path` for
the command-line interface.
