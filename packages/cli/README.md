# drone-path

Render a flight-path map overlay video from a DJI recording with CAM-meta
telemetry or a matching SRT sidecar. Use Node.js 24 or later.

```sh
npx drone-path "my-flight.mp4"
npx drone-path --help
```

By default, the command writes the overlay to `out/my-flight_map.mp4`.
See the [CLI guide](https://github.com/MrManny/drone-path/blob/main/docs/user/cli.md)
for configuration, rendering requirements, and track export.

The `drone-path` export provides typed CLI functions for Node.js. For
telemetry and rendering APIs, use `drone-path-core` and
`drone-path-engine`.
