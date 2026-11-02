# Tiles and attribution

## Sources

- `satellite`: Esri World Imagery — attribution *Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community* (Esri usage limits apply).
- `topo`: OpenTopoMap — attribution *© OpenStreetMap contributors, SRTM | Style: © OpenTopoMap (CC-BY-SA)*.

## Fetching and caching

Attribution is rendered into every frame. Tiles are fetched at a polite rate (~2.5 requests/s, custom `User-Agent`), cached permanently, and failed tiles are retried on the next run.
