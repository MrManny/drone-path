# App icon artwork

Source artwork and derived platform formats for the desktop app icon.

## Files

- `icon-master.png` — 512x512 RGBA master, downsampled with Lanczos from the
  maintainer's source artwork. It carries the final branding with real
  rounded-corner transparency (rounded-rectangle mask, corner radius 112 px =
  22% of the side) and no textual PNG metadata — only IHDR/IDAT/IEND chunks.
  Replace this file to rebrand, then re-derive the formats below.
- `icons/<n>x<n>.png` — 16 to 512 resizes of the master; the Linux icon set
  (`linux.icon` in `electron-builder.yml`).
- `icon.ico` — Windows application icon (`win.icon`), sizes 16 to 256. The
  256x256 entry is not for display: electron-builder's icon converter rejects
  an ICO without one.
- `icon.ico` and `icons/256x256.png` are also read at runtime as the window
  icon (`app/main.mjs`); `electron-builder.yml` lists them in `files` because
  build resources are not packed into the app by default.

## Provenance

`icon-master.png` is the final branded artwork created for this project by the
maintainer (no third-party assets). The derived formats inherit the master's
provenance and the project license (MIT).

## Deriving the platform formats

One-off steps, re-run when the master changes; no tool is added to the project.
The current master was produced with Python + Pillow: the source artwork was
re-encoded to drop its AI-tool metadata (ComfyUI workflow `tEXt` chunks), the
full-bleed square was masked to rounded-corner alpha (radius 112 px at 512),
and it was downsampled to 512 with Lanczos; the icon set resizes the master
with premultiplied-alpha Lanczos. Any decent resampler works for the resizing,
e.g. ImageMagick `magick icon-master.png -resize 256 256x256.png`.

Packed with [`png-to-ico`](https://www.npmjs.com/package/png-to-ico) (MIT),
installed temporarily under the git-ignored `.scratch/` and driven through its
array API (its CLI packs one input file into fixed 16/32/48/256 sizes):

```js
import fs from 'node:fs';
import pngToIco from 'png-to-ico';

const buf = await pngToIco([
  'build/icons/16x16.png', 'build/icons/24x24.png', 'build/icons/32x32.png',
  'build/icons/48x48.png', 'build/icons/64x64.png', 'build/icons/128x128.png',
  'build/icons/256x256.png',
]);
fs.writeFileSync('build/icon.ico', buf);
```

`png-to-ico` stores the entries as 32-bit BMP images (with an AND mask), so the
ICO embeds no PNG data and cannot carry PNG metadata.
