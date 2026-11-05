# Third-party notices

This repository vendors two icons from the [Lucide](https://lucide.dev) icon
set as TypeScript components under `ui/icons/`: `CloseIcon` ("x") and
`SettingsIcon` ("settings"). They are used unmodified except for JSX
serialization and fixed sizing. The ISC License below applies to both; the MIT
License additionally applies to `CloseIcon` ("x"), which Lucide derives from
the Feather project. The other glyphs under `ui/icons/` are original work in
the Lucide style and are not covered by these licenses.

## Lucide — ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## Feather (icons derived from it) — MIT License

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## FFmpeg and FFprobe (embedded binaries) — GPL-3.0

The desktop app distributions and the npm package may carry static `ffmpeg`
and `ffprobe` binaries so renders need no local install. They come from the
`@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` optional
dependencies and are spawned as separate processes; x264/x265 make these
GPL-3.0 builds. Build identifiers live in each platform package's metadata;
the desktop app ships, among others:

- ffmpeg: Windows x64 build `20181217-f22fcd4` (the win64 static builds once
  hosted at ffmpeg.zeranoe.com), Linux x64 build `20181210-g0e8eb07980`
  (https://www.johnvansickle.com/ffmpeg/).
- ffprobe: Windows x64 build `20230213-2296078`
  (https://www.gyan.dev/ffmpeg/builds/), Linux x64 build `20230721-c2b3861`
  (https://www.johnvansickle.com/ffmpeg/).

The full GPL-3.0 license text ships with every distribution:
`ff/GPL-3.0.txt` next to the binaries in the desktop app, and
`build/licenses/GPL-3.0.txt` in this repository and the npm package. The
corresponding source code is the FFmpeg release named by each build
identifier, available from https://ffmpeg.org/releases.html and
https://github.com/FFmpeg/FFmpeg; the per-platform build provenance is
documented by the installer packages at
https://github.com/kribblo/node-ffmpeg-installer and
https://github.com/SavageCore/node-ffprobe-installer.
