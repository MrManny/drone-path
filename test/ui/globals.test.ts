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

  function rulePattern(selector: string, fragment: string): RegExp {
    const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Selector prefix, then any grouped siblings up to the body, then the
    // declaration the recipe owes the state.
    return new RegExp(`${escape(selector)}[^{]*\\{[^}]*${escape(fragment)}`);
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

  it('gives a disabled chip the disabled recipe, not the off look', () => {
    // "disabled" (0.45) must read differently from "off" (0.55).
    expect(cssText).toMatch(rulePattern(".hud-chip[aria-pressed='false']", 'opacity: 0.55'));
    expect(cssText).toMatch(
      rulePattern(".hud-chip[aria-pressed='false']:disabled", 'opacity: var(--disabled-opacity)'),
    );
  });

  it.for([{ field: 'select' }, { field: "input[type='number']" }, { field: "input[type='text']" }])(
    'lightens the border of $field fields on hover',
    ({ field }) => {
      expect(cssText).toMatch(
        rulePattern(`.settings-row ${field}:hover:not(:disabled)`, 'border-color: var(--hairline-hover)'),
      );
    },
  );
});
