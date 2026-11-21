---
"drone-path": patch
"drone-path-archive": patch
"drone-path-core": patch
---

Let archive queries open an existing index while a scan holds a SQLite write reservation, and reduce repeated directory reads when scanning for SRT sidecars.
