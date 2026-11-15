// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TrailColorSwatches } from '../../ui/components/TrailColorSwatches.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function swatchButtons(): HTMLButtonElement[] {
  return [...screen.getByRole('group', { name: 'Trail color' }).querySelectorAll('button')];
}

describe('TrailColorSwatches', () => {
  it('shows the explicit Style default and the preset colors', () => {
    render(<TrailColorSwatches value={null} onChange={() => true} />);
    expect(swatchButtons().map((b) => b.textContent)).toEqual([
      'Style default',
      'Coral',
      'White',
      'Black',
      'Custom…',
    ]);
    expect(swatchButtons()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('emits the preset colors and the style default', () => {
    const onChange = vi.fn(() => true);
    render(<TrailColorSwatches value={null} onChange={onChange} />);
    fireEvent.click(swatchButtons()[1]);
    expect(onChange).toHaveBeenLastCalledWith('#e87f54');
    fireEvent.click(swatchButtons()[2]);
    expect(onChange).toHaveBeenLastCalledWith('#ffffff');
    fireEvent.click(swatchButtons()[3]);
    expect(onChange).toHaveBeenLastCalledWith('#000000');
    fireEvent.click(swatchButtons()[0]);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('reveals the hex field from Custom… and emits a canonical hex', () => {
    const onChange = vi.fn(() => true);
    render(<TrailColorSwatches value={null} onChange={onChange} />);
    fireEvent.click(swatchButtons()[4]);
    const field = screen.getByLabelText('Hex');
    fireEvent.change(field, { target: { value: '41f0ff' } });
    expect(onChange).toHaveBeenLastCalledWith('#41f0ff');
    expect(onChange).not.toHaveBeenCalledWith(null);
  });

  it('blocks an invalid hex with the rule instead of emitting it', () => {
    const onChange = vi.fn(() => true);
    render(<TrailColorSwatches value={null} onChange={onChange} />);
    fireEvent.click(swatchButtons()[4]);
    fireEvent.change(screen.getByLabelText('Hex'), { target: { value: 'neon' } });
    expect(screen.getByText('Must be hex like #e63946.')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('starts in custom mode for a stored custom color', () => {
    render(<TrailColorSwatches value="#41f0ff" onChange={() => true} />);
    expect((screen.getByLabelText<HTMLInputElement>('Hex')).value).toBe('#41f0ff');
    expect(swatchButtons()[4].getAttribute('aria-pressed')).toBe('true');
    expect(swatchButtons()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('returns to the style default when the field is cleared', () => {
    function Harness() {
      const [value, setValue] = useState<string | null>('#41f0ff');
      return (
        <TrailColorSwatches
          value={value}
          onChange={(next) => {
            setValue(next);
            return true;
          }}
        />
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Hex'), { target: { value: '' } });
    expect(screen.queryByLabelText('Hex')).toBeNull();
    expect(swatchButtons()[0].getAttribute('aria-pressed')).toBe('true');
    expect(swatchButtons()[4].getAttribute('aria-pressed')).toBe('false');
  });
});
