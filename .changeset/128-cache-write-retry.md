---
"neo2-flightpath": patch
---

Tile cache write failures (ENOSPC, an unwritable cache, a cache path that is not a directory) now fail the affected tile with an error naming the cache instead of being retried as download errors and silently degrading to a placeholder.
