import type { SceneData } from '../../src/renderer/scene.js';

/** The three on-frame readouts, in the order the chips appear. */
export type HudChipId = 'heading' | 'alt' | 'speed';

export interface ChipReadouts {
  headingDeg: number | null;
  alt: number | null;
  speed: number | null;
}

type ChipChannels = Pick<SceneData, 'alt' | 'speed' | 'headingDeg'>;

/** The values the chips show at one frame, as the renderer reads them. */
export function chipReadoutsAt(channels: ChipChannels, frame: number): ChipReadouts {
  const i = Math.max(0, Math.min(channels.alt.length - 1, Math.round(frame)));
  return {
    headingDeg: channels.headingDeg[i] ?? null,
    alt: channels.alt[i] ?? null,
    speed: channels.speed[i] ?? null,
  };
}

/** A missing or disabled value renders as the dimmed "--", like the map strip. */
export function formatChipValue(chip: HudChipId, readouts: ChipReadouts): string {
  if (chip === 'heading') return readouts.headingDeg === null ? '--' : '';
  const value = chip === 'alt' ? readouts.alt : readouts.speed;
  if (value === null) return '--';
  return chip === 'alt' ? String(Math.round(value)) : value.toFixed(1);
}
