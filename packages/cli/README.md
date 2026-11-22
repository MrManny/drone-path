# drone-path

Render flight-path map overlay videos from DJI recordings with CAM-meta
telemetry or a matching SRT sidecar, index and search a local recording library,
or expose your library to AI agents over an MCP server. Use Node.js 24 or later.

```sh
npx drone-path "my-flight.mp4"
npx drone-path archive scan "./flights" --recurse --json
npx drone-path mcp --allow-root "./flights"
npx drone-path --help
```

By default, rendering writes the overlay to `out/my-flight_map.mp4`.
See the [CLI guide](https://github.com/MrManny/drone-path/blob/main/docs/user/cli.md)
for configuration, archive search, MCP tools, rendering requirements, and track
export.

The `drone-path` export provides typed CLI functions for Node.js. For telemetry,
library indexing, and rendering APIs, use `drone-path-core`,
`drone-path-archive`, and `drone-path-engine`.

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
