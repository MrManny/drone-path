# App icon artwork

Source artwork and derived platform formats for the desktop app icon.

## Files

- `icon-master.svg` — the source artwork: a 512x512 pure-vector SVG (Inkscape,
  no embedded raster) defining the circular badge with the drone glyph.
  Committed so the derivation chain below can be re-run.
- `icon-master.png` — 512x512 RGBA master rasterized from `icon-master.svg`.
  The badge keeps the artwork's own alpha shape (transparent outside the
  circle and the overhanging glyph, anti-aliased rim) and no textual PNG
  metadata — only IHDR/IDAT/IEND chunks. Replace the SVG and this file to
  rebrand, then re-derive the formats below.
- `icons/<n>x<n>.png` — 16 to 512 sizes derived from the master (512 carries
  the master's pixels); the Linux icon set (`linux.icon` in `electron-builder.yml`).
- `icon.ico` — Windows application icon (`win.icon`), sizes 16 to 256. The
  256x256 entry is not for display: electron-builder's icon converter rejects
  an ICO without one.
- `icon.ico` and `icons/256x256.png` are also read at runtime as the window
  icon (`app/main.mjs`); `electron-builder.yml` lists them in `files` because
  build resources are not packed into the app by default.

## Provenance

`icon-master.svg` and the master raster were provided by the maintainer as the
final branded artwork for this project (no third-party assets). The derived
formats inherit the source's provenance and the project license (MIT).

## Deriving the platform formats

One-off steps, re-run when the source changes; no tool is added to the project.
Temporary tools live in the git-ignored `.scratch/`.

1. Rasterize `icon-master.svg` to 512x512 RGBA with an SVG renderer — headless
   Chrome was used here (load the SVG in a zero-margin page and screenshot at
   512x512 with a transparent background).
2. With Python + Pillow: keep the raster's own alpha, fill the RGB channels of
   fully transparent pixels with the badge's dark color `#232323` so
   non-premultiplied resamplers stay fringe-free, and save as `icon-master.png`
   (only IHDR/IDAT/IEND chunks).
3. Resize the master to the icon set with premultiplied-alpha Lanczos, clamping
   each pixel's alpha to its source-neighborhood min/max so resampling cannot
   ring alpha outside the source's support. Any decent resampler works for the
   resizing, e.g. ImageMagick `magick icon-master.png -resize 256 256x256.png`
   (mind the premultiplied alpha).

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
