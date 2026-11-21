# Third-party notices

Zod is licensed under MIT and ships its license in its npm package.

## FFmpeg and FFprobe binaries

The `ffmpeg-ffprobe-static` optional dependency downloads FFmpeg and FFprobe
7.1.0 builds from its
[b7.1.0-rc.1 release](https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/tag/b7.1.0-rc.1).
Drone Path spawns these binaries as separate processes. The x264 and x265
encoders make these builds GPL-3.0-or-later.

- Windows x64 uses the gyan.dev `7.1-essentials_build-www.gyan.dev` build.
  The corresponding source is the [FFmpeg 7.1 release](https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz).
- Linux x64 uses the BtbN FFmpeg-Builds autobuild
  `ffmpeg-n7.1-15-g9fbbd924f2-linux64-gpl-7.1`. The corresponding source
  is [FFmpeg commit 9fbbd924f2](https://github.com/FFmpeg/FFmpeg/commit/9fbbd924f2).

The dependency places the full GPL license text beside the binaries as
`ffmpeg.LICENSE` (`ffmpeg.exe.LICENSE` on Windows). The wrapper's own
`LICENSE` file is BSD-3-Clause and credits Eugene Ware and contributors.
