import { describe, expect, it } from 'vitest';

import { renderOpts } from '../../../../test/fixtures/render.js';
import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import { renderVideo } from 'drone-path-engine/render';
import type { CaptureProgress } from 'drone-path-engine/render';
import { captureFraction, exportReducer, initialExportState } from '../../ui/lib/exportstate.js';

describe('capture progress events', () => {
  it('pair the render emitter with the export UI consumer', async () => {
    const events: CaptureProgress[] = [];
    await renderVideo(renderOpts({ frames: 250, onCapture: (p) => events.push(p) }));

    expect(events).toEqual([
      { done: 100, total: 250 },
      { done: 200, total: 250 },
      { done: 250, total: 250 },
    ]);

    let state = exportReducer(initialExportState(768, 768), {
      type: 'start',
      request: { outPath: '/exports/a.mp4', config: { ...DEFAULT_CONFIG }, range: null },
    });
    const fractions: (number | null)[] = [];
    for (const progress of events) {
      state = exportReducer(state, { type: 'capture', progress });
      fractions.push(captureFraction(state.capture));
    }
    expect(fractions).toEqual([0.4, 0.8, 1]);
  });
});
