'use client';

import type { WarmProgress } from '../../src/appsession.js';
import { tilesWarmingText } from '../lib/preparetext.js';

export interface WarmHintProps {
  progress: WarmProgress;
}

// The background pre-warm's status chip over the stage: it counts the plan's
// tiles until the last one settles, then disappears (design guidelines §8.6).
export function WarmHint({ progress }: WarmHintProps) {
  if (progress.total <= 0 || progress.done >= progress.total) return null;
  return (
    <div className="warm-hint" role="status">
      {tilesWarmingText(progress.done, progress.total)}
    </div>
  );
}
