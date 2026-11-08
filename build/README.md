# App icon artwork

Source artwork and derived platform formats for the desktop app icon.

## Files

- `icon-master.svg` — 512x512 pure-vector source (Inkscape, no embedded
  raster); committed so the chain below can be re-run.
- `icon-master.png` — 512x512 RGBA master rasterized from the SVG, keeping the
  artwork's own alpha shape and IHDR/IDAT/IEND chunks only. Replace these two
  to rebrand, then re-derive.
- `icons/<n>x<n>.png` — 16 to 512 from the master (512 carries the master's
  pixels); the Linux icon set (`linux.icon` in `electron-builder.yml`).
- `icon.ico` — Windows icon (`win.icon`), 16 to 256; the never-displayed
  256x256 entry is required by electron-builder's converter.
- `icon.ico` and `icons/256x256.png` are the runtime window icon
  (`app/main.mjs`), listed in `files` because build resources are not packed
  into the app by default.

## Provenance

Provided by the maintainer as the final branded artwork (no third-party
assets); the derived formats inherit its provenance and the MIT project
license.

## Deriving the platform formats

One-off steps; temporary tools live in the git-ignored `.scratch/` and are not
added to the project.

1. Rasterize `icon-master.svg` to 512x512 RGBA (headless Chrome here: zero-margin
   page, 512x512 screenshot, transparent background).
2. Python + Pillow: keep the raster's alpha, fill transparent pixels' RGB with
   the badge's `#232323` to keep non-premultiplied resamplers fringe-free; save
   with IHDR/IDAT/IEND only.
3. Resize with premultiplied-alpha Lanczos, clamping each pixel's alpha to its
   source-neighborhood min/max so resampling cannot ring outside the source's
   support.

Packed with [`png-to-ico`](https://www.npmjs.com/package/png-to-ico) (MIT,
installed temporarily under `.scratch/`) via its array API — its CLI packs one
file into fixed 16/32/48/256 sizes:

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

Entries are 32-bit BMP + AND mask: the ICO embeds no PNG data and cannot carry
PNG metadata.
