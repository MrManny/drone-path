---
"drone-path": patch
---

Require explicit `--allow-root` directories, guard `export_markers` and `render_map_video` against overwriting existing files by default, cap `render_map_video` batch size per tool call, and redact filesystem paths from MCP responses and `stderr` logs.
