// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConfigOverrides } from 'drone-path-engine/config';
import { CameraControls } from '../../ui/components/CameraControls.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderControls(
  over: Partial<{
    view: 'overview' | 'follow';
    zoom: number;
    framePadding: number;
  }> = {},
  onChange: (patch: ConfigOverrides) => boolean = () => true,
) {
  return render(
    <CameraControls
      view={over.view ?? 'overview'}
      zoom={over.zoom ?? 0}
      framePadding={over.framePadding ?? 1}
      resolvedZoom={13}
      style="satellite"
      onChange={onChange}
    />,
  );
}

describe('CameraControls', () => {
  it('emits the camera view from the segmented control', () => {
    const onChange = vi.fn(() => true);
    renderControls({}, onChange);
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(onChange).toHaveBeenCalledWith({ view: 'follow' });
  });

  it('replaces the zoom value 0 with an auto-fit toggle', () => {
    const onChange = vi.fn(() => true);
    renderControls({ zoom: 0 }, onChange);
    const toggle = screen.getByLabelText<HTMLInputElement>('Auto-fit zoom');
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ zoom: 13 });
  });

  it('returns to auto-fit when the toggle comes back on', () => {
    const onChange = vi.fn(() => true);
    renderControls({ zoom: 13 }, onChange);
    const toggle = screen.getByLabelText<HTMLInputElement>('Auto-fit zoom');
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ zoom: 0 });
  });

  it('disables the zoom slider under auto-fit and shows the resolved level', () => {
    renderControls({ zoom: 0 });
    const slider = screen.getByLabelText<HTMLInputElement>('Zoom level');
    expect(slider.disabled).toBe(true);
    expect(slider.value).toBe('13');
    expect(slider.getAttribute('aria-valuetext')).toBe('auto-fit → 13');
    expect(screen.getByText('auto-fit → 13')).toBeTruthy();
  });

  it('pins the zoom level from the slider once auto-fit is off', () => {
    const onChange = vi.fn(() => true);
    renderControls({ zoom: 13 }, onChange);
    const slider = screen.getByLabelText<HTMLInputElement>('Zoom level');
    expect(slider.disabled).toBe(false);
    expect(slider.min).toBe('2');
    expect(slider.max).toBe('19');
    fireEvent.change(slider, { target: { value: '17' } });
    expect(onChange).toHaveBeenCalledWith({ zoom: 17 });
    expect(screen.getByText('13')).toBeTruthy();
  });

  it('keeps frame padding to auto-fit and counts the levels', () => {
    const onChange = vi.fn(() => true);
    renderControls({ zoom: 0, framePadding: 1 }, onChange);
    const slider = screen.getByLabelText<HTMLInputElement>('Frame padding');
    expect(slider.disabled).toBe(false);
    expect(screen.getByText('1 level')).toBeTruthy();
    expect(screen.queryByText('auto-fit only')).toBeNull();
    fireEvent.change(slider, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ zoomOut: 3 });
  });

  it('explains the disabled frame padding while the zoom is pinned', () => {
    renderControls({ zoom: 13, framePadding: 2 });
    const slider = screen.getByLabelText<HTMLInputElement>('Frame padding');
    expect(slider.disabled).toBe(true);
    expect(screen.getByText('2 levels')).toBeTruthy();
    const hint = screen.getByText('auto-fit only');
    expect(slider.getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('shows and keeps a stored padding above the slider range until it is edited', () => {
    const onChange = vi.fn(() => true);
    renderControls({ zoom: 0, framePadding: 15 }, onChange);
    const slider = screen.getByLabelText<HTMLInputElement>('Frame padding');
    expect(slider.value).toBe('15');
    expect(slider.max).toBe('15');
    expect(screen.getByText('15 levels')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith({ zoomOut: 4 });
  });
});
