import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Cross-component style contracts for ui/app/globals.css: state recipes that
// span the shared controls and no single component test owns. Written like
// the component style contracts (zoomstepper.test.tsx, mapcard.test.tsx) —
// the stylesheet text is the unit under test.
describe('selection-state style contract (#285)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cssText = fs.readFileSync(path.join(root, 'ui', 'app', 'globals.css'), 'utf8');

  function tokenValue(name: string): string {
    const match = new RegExp(`${escape(name)}:\\s*([^;]+);`).exec(cssText);
    if (!match) throw new Error(`missing CSS token ${name}`);
    return match[1].trim();
  }

  function parseColor(raw: string): [number, number, number, number] {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
    if (hex) {
      const digits =
        hex[1].length === 3
          ? [...hex[1]].map((ch) => parseInt(ch + ch, 16))
          : [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
      return [digits[0], digits[1], digits[2], 1];
    }
    const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      raw.trim(),
    );
    if (rgba) {
      return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] ? Number(rgba[4]) : 1];
    }
    throw new Error(`unsupported color format: ${raw}`);
  }

  function composite(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
    const [, , , a] = fg;
    return [0, 1, 2].map((i) => a * fg[i] + (1 - a) * bg[i]) as [number, number, number];
  }

  function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
    const lum = (rgb: [number, number, number]) => {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [l1, l2] = [lum(fg), lum(bg)];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function rulePattern(selector: string, fragment: string): RegExp {
    // Selector prefix, then any grouped siblings up to the body, then the
    // declaration the recipe owes the state — never crossing a closing
    // brace into a neighboring rule's body.
    return new RegExp(`${escape(selector)}[^}]*\\{[^}]*${escape(fragment)}`);
  }

  it.for([
    {
      control: 'HUD chips',
      selector: ".hud-chip[aria-pressed='true']:hover",
      marker: ['border-color: var(--accent)'],
    },
    {
      control: 'map style tiles',
      selector: ".map-style-tile[aria-pressed='true']:hover",
      marker: ['border-color: var(--accent)', 'box-shadow: 0 0 0 1px var(--accent)'],
    },
    {
      control: 'trail swatches',
      selector: ".trail-swatch[aria-pressed='true']:hover",
      marker: ['border-color: var(--accent)'],
    },
    {
      control: 'structure segments',
      selector: ".structure-seg[aria-pressed='true']:hover",
      marker: ['border-color: var(--accent)', 'color: var(--accent-text)'],
    },
  ])('keeps the selection marker on $control while hovered', ({ selector, marker }) => {
    for (const fragment of marker) {
      expect(cssText).toMatch(rulePattern(selector, fragment));
    }
  });

  it('gives an off HUD chip an opaque high-contrast recipe distinct from disabled (#285, #397)', () => {
    expect(cssText).not.toMatch(rulePattern(".hud-chip[aria-pressed='false']", 'opacity: 0.55'));
    expect(cssText).toMatch(rulePattern(".hud-chip[aria-pressed='false']", 'background: var(--surface-2)'));
    expect(cssText).toMatch(rulePattern(".hud-chip[aria-pressed='false']", 'color: var(--text-2)'));
    expect(cssText).toMatch(rulePattern(".hud-chip[aria-pressed='false'] .unit", 'opacity: 1'));
    expect(cssText).toMatch(rulePattern(".hud-chip[aria-pressed='false'] .unit", 'color: var(--text-3)'));
    expect(cssText).toMatch(
      rulePattern(".hud-chip[aria-pressed='false']:disabled", 'opacity: var(--disabled-opacity)'),
    );

    const text2 = parseColor(tokenValue('--text-2'));
    const text3 = parseColor(tokenValue('--text-3'));
    for (const surfaceToken of ['--surface-2', '--surface-3']) {
      const surface = parseColor(tokenValue(surfaceToken)).slice(0, 3) as [number, number, number];
      expect(contrastRatio(composite(text2, surface), surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(composite(text3, surface), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws an inset focus ring on the timeline range slider so .track overflow does not clip it (#395)', () => {
    expect(cssText).toMatch(rulePattern(".track input[type='range']:focus-visible", 'outline: 2px solid var(--focus)'));
    expect(cssText).toMatch(rulePattern(".track input[type='range']:focus-visible", 'outline-offset: -2px'));
  });

  it('applies the shared --focus outline to links and pads .help-nav for it (#407)', () => {
    expect(cssText).toMatch(rulePattern('a:focus-visible', 'outline: 2px solid var(--focus)'));
    expect(cssText).toMatch(rulePattern('a:focus-visible', 'outline-offset: 2px'));
    expect(cssText).toMatch(rulePattern('.help-nav', 'padding: 4px'));
  });

  it('gives every .busy-status span a var(--bar) backdrop with >= 4.5:1 contrast over white tiles (#409)', () => {
    expect(cssText).toMatch(rulePattern('.busy-status span', 'background: var(--bar)'));
    expect(cssText).not.toMatch(/\.track > \.busy-status span\s*\{/);

    const whiteTile: [number, number, number] = [255, 255, 255];
    const barBg = composite(parseColor(tokenValue('--bar')), whiteTile);
    const text3 = composite(parseColor(tokenValue('--text-3')), barBg);
    expect(contrastRatio(text3, barBg)).toBeGreaterThanOrEqual(4.5);
  });

  it.for([{ field: 'select' }, { field: "input[type='number']" }, { field: "input[type='text']" }])(
    'lightens the border of $field fields on hover',
    ({ field }) => {
      expect(cssText).toMatch(
        rulePattern(`.settings-row ${field}:hover:not(:disabled)`, 'border-color: var(--hairline-hover)'),
      );
    },
  );

  it('wraps form rows and allows messages and hints to wrap under zoom (#410)', () => {
    expect(cssText).toMatch(rulePattern('.settings-row', 'flex-wrap: wrap'));
    expect(cssText).toMatch(rulePattern('.opening-ending-steppers', 'flex-wrap: wrap'));
    expect(cssText).toMatch(rulePattern('.field-message', 'overflow-wrap: anywhere'));
    expect(cssText).not.toMatch(rulePattern('.field-message', 'white-space: nowrap'));
    expect(cssText).toMatch(rulePattern('.settings-row .hint', 'overflow-wrap: anywhere'));
    expect(cssText).not.toMatch(rulePattern('.settings-row .hint', 'white-space: nowrap'));
  });

  it('stacks Export and Help dialog columns on narrow viewports (#410)', () => {
    const mediaBlock = /@media \(max-width: 680px\) \{([\s\S]*?)\n\}/.exec(cssText)?.[1] ?? '';
    expect(mediaBlock).toContain('.export-body');
    expect(mediaBlock).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(mediaBlock).toContain('.help-body');
    expect(mediaBlock).toContain('flex-direction: column');
    expect(mediaBlock).toContain('.help-nav');
    expect(mediaBlock).toContain('position: static');
    expect(mediaBlock).toContain('width: auto');
    expect(mediaBlock).toContain('box-sizing: border-box');
    expect(mediaBlock).not.toContain('width: 100%');
  });

  it('resets heading margins on .preview-title and flexes .workspace-main (#411)', () => {
    expect(cssText).toMatch(rulePattern('.preview-title', 'margin: 0'));
    expect(cssText).toMatch(rulePattern('.workspace-main', 'flex: 1 1 auto'));
    expect(cssText).toMatch(rulePattern('.workspace-main', 'display: flex'));
  });
});
