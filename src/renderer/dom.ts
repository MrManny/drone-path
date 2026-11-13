import type { HudLayout } from '../config.js';
import type { TileSource } from './tilesources.js';
import type { Theme } from './theme.js';

function mapCss(
  at: string,
  src: TileSource,
  theme: Theme,
  width: number,
  height: number,
): string {
  return `
  ${at} { margin: 0; padding: 0; overflow: hidden; background: ${src.bg}; }
  ${at}, ${at} * { animation: none !important; transition: none !important; }
  ${at} #map-frame {
    position: absolute; inset: 0; overflow: hidden; background: ${src.bg};
  }
  ${at} #map {
    position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px;
    /* Leaflet's own container default is a light gray; the un-tiled field
       takes the style's background so it never flashes bright (#167). */
    background: ${src.bg};
  }
  ${at} .leaflet-tile-pane { filter: ${src.tileFilter ?? 'none'}; }
  ${at} #vignette {
    position: absolute; inset: 0; z-index: 500; pointer-events: none;
    background: radial-gradient(ellipse 78% 78% at 50% 44%,
      rgba(0,0,0,0) 52%, rgba(0,0,0,${theme.vignette}) 100%);
  }`;
}

function droneCss(at: string, theme: Theme, scale: number): string {
  return `
  ${at} .drone-wrap {
    width: ${Math.round(46 * scale)}px; height: ${Math.round(46 * scale)}px;
    border-radius: 50%;
    background: ${theme.discBg};
    border: ${Math.max(2, Math.round(2.2 * scale))}px solid rgba(255,255,255,0.92);
    box-shadow:
      0 0 0 ${Math.round(7 * scale)}px ${theme.glow},
      0 ${Math.round(3 * scale)}px ${Math.round(12 * scale)}px rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    box-sizing: border-box;
  }
  ${at} .drone-arrow { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  ${at} .drone-arrow svg { width: 72%; height: 72%; display: block; }`;
}

function chipCss(at: string, theme: Theme, scale: number): string {
  return `
  ${at} #hud {
    position: absolute; top: ${Math.round(16 * scale)}px; left: ${Math.round(16 * scale)}px;
    display: flex; flex-direction: column; gap: ${Math.round(8 * scale)}px;
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    z-index: 1200; pointer-events: none;
  }
  ${at} .chip {
    background: rgba(14,19,28,0.9);
    backdrop-filter: blur(${Math.round(14 * scale)}px) saturate(1.25);
    -webkit-backdrop-filter: blur(${Math.round(14 * scale)}px) saturate(1.25);
    color: #ffffff;
    padding: ${Math.round(6 * scale)}px ${Math.round(14 * scale)}px ${Math.round(6 * scale)}px ${Math.round(13 * scale)}px;
    border-radius: ${Math.round(13 * scale)}px;
    font-size: ${Math.round(21 * scale)}px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.3px;
    display: inline-flex; align-items: baseline; gap: ${Math.round(7 * scale)}px;
    width: fit-content;
    border: 1px solid rgba(255,255,255,0.20);
    box-shadow:
      inset ${Math.max(3, Math.round(3 * scale))}px 0 0 ${theme.core},
      0 ${Math.round(6 * scale)}px ${Math.round(18 * scale)}px rgba(0,0,0,0.30);
  }
  ${at} .chip .label {
    font-size: 0.55em; font-weight: 700; letter-spacing: 1.2px;
    color: ${theme.core}; opacity: 0.95;
  }
  ${at} .chip .unit { font-weight: 500; opacity: 0.72; font-size: 0.68em; }`;
}

function attrCss(at: string, scale: number): string {
  return `
  ${at} #attr {
    position: absolute; right: 0; bottom: 0; z-index: 1000; max-width: 72%;
    background: rgba(12, 14, 22, 0.62); color: rgba(255,255,255,0.78);
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: ${Math.round(11 * scale)}px; line-height: 1.35;
    padding: ${Math.round(2 * scale)}px ${Math.round(8 * scale)}px;
    border-radius: ${Math.round(4 * scale)}px 0 0 0;
    pointer-events: none;
  }
  ${at} #attr a { color: rgba(255,255,255,0.92); text-decoration: none; }`;
}

function scaleBarCss(at: string, scale: number): string {
  return `
  ${at} #scalebar {
    position: absolute; left: ${Math.round(10 * scale)}px; bottom: ${Math.round(8 * scale)}px;
    z-index: 1000; pointer-events: none;
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  ${at} #scaletext {
    display: block; color: #ffffff; font-size: ${Math.round(11 * scale)}px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.8); margin-bottom: 2px;
  }
  ${at} #scaleline {
    height: ${Math.max(4, Math.round(5 * scale))}px;
    border: 1px solid rgba(255,255,255,0.85); border-top: none;
    box-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }`;
}

export function sceneCss(
  src: TileSource,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
  scope: string,
): string {
  const at = `.${scope}`;
  return (
    mapCss(at, src, theme, width, height) +
    droneCss(at, theme, scale) +
    chipCss(at, theme, scale) +
    attrCss(at, scale) +
    scaleBarCss(at, scale)
  );
}

export function hudMarkup(hud: HudLayout): string {
  const chips: string[] = [];
  if (hud.alt) {
    chips.push(
      '<div class="chip" id="chip-alt"><span class="label">ALT</span><span class="num">--</span><span class="unit">m</span></div>',
    );
  }
  if (hud.speed) {
    chips.push(
      '<div class="chip" id="chip-speed"><span class="label">SPD</span><span class="num">--</span><span class="unit">m/s</span></div>',
    );
  }
  return chips.map((chip) => `  ${chip}`).join('\n');
}

/** A null hud keeps the chips out of the map frame: the caller mounts them in
    a strip outside the map image instead. */
export function mapMarkup(hud: HudLayout | null, attribution: string): string {
  const hudBlock =
    hud === null ? '' : `<div id="hud">
${hudMarkup(hud)}
</div>
`;
  return `<div id="map-frame">
<div id="map"></div>
<div id="vignette"></div>
${hudBlock}<div id="attr">${attribution}</div>
<div id="scalebar"><span id="scaletext"></span><div id="scaleline"></div></div>
</div>`;
}

/** Attribution links are on-screen credits, not controls: keyboard skips them. */
export function quietAttributionLinks(attr: HTMLElement): void {
  for (const a of attr.querySelectorAll('a')) a.setAttribute('tabindex', '-1');
}

export function droneMarkerMarkup(coreColor: string): string {
  return (
    '<div class="drone-wrap"><div class="drone-arrow" id="drone-arrow">' +
    '<svg viewBox="0 0 24 24"><path d="M12 1.8 L21 22 L12 16.9 L3 22 Z" fill="' +
    coreColor +
    '" stroke="rgba(255,255,255,0.9)" stroke-width="0.9" stroke-linejoin="round"/></svg>' +
    '</div></div>'
  );
}

export function el<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`renderer element missing: ${selector}`);
  return found;
}
