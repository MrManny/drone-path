// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { asTrailColor } from '../../src/config.js';
import { ColorField } from '../../ui/components/ColorField.js';
import type { ColorFieldProps } from '../../ui/components/ColorField.js';

afterEach(cleanup);

function renderColor(overrides: Partial<ColorFieldProps> = {}) {
  const onValue = overrides.onValue ?? vi.fn(() => true);
  render(
    <ColorField
      label="Trail color"
      value={null}
      parse={(raw) => asTrailColor(raw, 'trail color')}
      rule="hex like #e63946"
      hint="empty = map style's color"
      {...overrides}
      onValue={onValue}
    />,
  );
  return { input: screen.getByLabelText<HTMLInputElement>('Trail color'), onValue };
}

describe.each(['#e63946', '41f0ff', '#f00c'])('a valid color %s', (value) => {
  it('commits the canonical value and shows no message', () => {
    const { input, onValue } = renderColor();
    fireEvent.change(input, { target: { value } });
    expect(onValue).toHaveBeenCalledWith(asTrailColor(value, 'trail color'));
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Must be hex like #e63946.')).toBeNull();
    expect(screen.getByText("empty = map style's color")).toBeTruthy();
  });
});

describe('an empty ColorField', () => {
  it('commits the unset value so the default applies', () => {
    const { input, onValue } = renderColor({ value: '#41f0ff' });
    fireEvent.change(input, { target: { value: '' } });
    expect(onValue).toHaveBeenCalledWith(null);
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});

describe.each([
  { value: 'neon', description: 'an unreadable value' },
  { value: '#12345', description: 'a truncated hex' },
  { value: 'rgb(1,2,3)', description: 'a CSS color notation' },
])('a rejected value: $description', ({ value }) => {
  it('names the rule, marks the field invalid and commits nothing', () => {
    const { input, onValue } = renderColor();
    fireEvent.change(input, { target: { value } });
    const message = screen.getByText('Must be hex like #e63946.');
    expect(onValue).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(message.id);
    expect(input.value).toBe(value);
    expect(screen.queryByText("empty = map style's color")).toBeNull();
  });
});

describe('ColorField message lifecycle', () => {
  it('keeps the message until the draft becomes valid', () => {
    const { input, onValue } = renderColor();
    fireEvent.change(input, { target: { value: 'neon' } });
    expect(screen.getByText('Must be hex like #e63946.')).toBeTruthy();
    fireEvent.change(input, { target: { value: '#41f0ff' } });
    expect(screen.queryByText('Must be hex like #e63946.')).toBeNull();
    expect(onValue).toHaveBeenLastCalledWith('#41f0ff');
  });

  it('clears the message and reverts the draft on blur', () => {
    const { input } = renderColor({ value: '#e63946' });
    fireEvent.change(input, { target: { value: 'neon' } });
    fireEvent.blur(input);
    expect(screen.queryByText('Must be hex like #e63946.')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.value).toBe('#e63946');
  });
});

describe('ColorField when the settings reject a value the field accepts', () => {
  it('marks the field invalid instead of accepting it', () => {
    const { input, onValue } = renderColor({ onValue: vi.fn(() => false) });
    fireEvent.change(input, { target: { value: '#41f0ff' } });
    expect(onValue).toHaveBeenCalledWith('#41f0ff');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Must be hex like #e63946.')).toBeTruthy();
  });
});

describe('the swatch', () => {
  function field(value: string | null) {
    return (
      <ColorField
        label="Trail color"
        value={value}
        parse={(raw) => asTrailColor(raw, 'trail color')}
        rule="hex like #e63946"
        onValue={() => true}
      />
    );
  }

  it('shows the committed color and flags the unset state', () => {
    const { container, rerender } = render(field('#41f0ff'));
    const swatch = container.querySelector('.color-swatch') as HTMLElement;
    expect(swatch).toBeTruthy();
    expect(swatch.className).toBe('color-swatch');
    expect(swatch.getAttribute('style')).toContain('background');
    rerender(field(null));
    const empty = container.querySelector('.color-swatch') as HTMLElement;
    expect(empty.className).toContain('color-swatch-empty');
  });
});
