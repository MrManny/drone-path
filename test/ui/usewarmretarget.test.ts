// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/config.js';
import type { WarmRequest } from '../../src/appsession.js';
import type { StageLayout } from '../../ui/lib/layout.js';
import { useWarmRetarget } from '../../ui/hooks/useWarmRetarget.js';

const SETTINGS = { ...DEFAULT_CONFIG };

describe('useWarmRetarget', () => {
  it('pivots once on mount and again on every resize', () => {
    const retarget = vi.fn();
    renderHook(() => useWarmRetarget(retarget, SETTINGS, 'split'));
    expect(retarget).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(retarget).toHaveBeenCalledTimes(3);
  });

  it('plans the frame for the current layout', () => {
    const retarget = vi.fn();
    const { rerender } = renderHook(
      ({ layout }: { layout: StageLayout }) => useWarmRetarget(retarget, SETTINGS, layout),
      { initialProps: { layout: 'split' as StageLayout } },
    );
    const first = retarget.mock.calls[0][0] as WarmRequest;
    expect(first.frame.width).toBeGreaterThan(0);
    rerender({ layout: 'overlay' });
    const last = retarget.mock.calls[retarget.mock.calls.length - 1][0] as WarmRequest;
    expect(last.frame.width).toBe(last.frame.height);
  });

  it('does nothing without a retarget handler', () => {
    renderHook(() => useWarmRetarget(undefined, SETTINGS, 'split'));
    window.dispatchEvent(new Event('resize'));
  });
});
