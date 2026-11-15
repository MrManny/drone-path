'use client';

import type { ConfigOverrides } from '../../src/config.js';
import { formatTime } from '../lib/frametime.js';
import { NumberField } from './NumberField.js';

export type PreviewSegment = 'intro' | 'flight' | 'outro';

interface OpeningEndingStripProps {
  introSec: number;
  outroSec: number;
  /** The flight length the intro and outro ease around. */
  flightSec: number;
  /** Which end of the flight the preview currently shows. */
  selected: PreviewSegment;
  onSelect: (segment: PreviewSegment) => void;
  onChange: (patch: ConfigOverrides) => boolean;
}

/**
 * The opening & ending strip: the structure bar names the three phases (its
 * segments also pick the preview frame, so both eases become visible), and
 * the steppers set the ease length on one baseline.
 */
export function OpeningEndingStrip({
  introSec,
  outroSec,
  flightSec,
  selected,
  onSelect,
  onChange,
}: OpeningEndingStripProps) {
  const segments: ReadonlyArray<{ id: PreviewSegment; grow: number; label: string }> = [
    { id: 'intro', grow: Math.max(introSec, 0.01), label: 'intro' },
    { id: 'flight', grow: Math.max(flightSec, 0.01), label: `flight ${formatTime(flightSec)}` },
    { id: 'outro', grow: Math.max(outroSec, 0.01), label: 'outro' },
  ];
  // The planner shortens both eases together when they exceed half the clip;
  // the strip says so instead of silently disagreeing with the fields.
  const willShorten = introSec + outroSec > flightSec / 2;
  return (
    <fieldset className="settings-group opening-ending">
      <legend>Opening &amp; ending</legend>
      <div className="structure-bar" role="group" aria-label="Flight structure">
        {segments.map(({ id, grow, label }) => (
          <button
            key={id}
            type="button"
            className={`structure-seg structure-seg-${id}`}
            style={{ flexGrow: grow }}
            aria-pressed={selected === id}
            aria-label={`${label} segment`}
            title={`Preview the ${id === 'flight' ? 'flight' : id === 'intro' ? 'opening' : 'ending'}`}
            onClick={() => onSelect(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="opening-ending-steppers">
        <NumberField
          label="Intro zoom"
          value={introSec}
          min={0}
          step={0.5}
          rule="at least 0"
          unit="s"
          onValue={(introSec) => onChange({ introSec })}
        />
        <p className="hint">the camera eases in and out · 0 s disables it</p>
        <NumberField
          label="Outro zoom"
          value={outroSec}
          min={0}
          step={0.5}
          rule="at least 0"
          unit="s"
          onValue={(outroSec) => onChange({ outroSec })}
        />
      </div>
      {willShorten ? <p className="hint">Intro and outro shorten to fit this clip.</p> : null}
    </fieldset>
  );
}
