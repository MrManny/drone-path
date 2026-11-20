'use client';

import { useTranslation } from '../lib/i18n.js';
import type { ConfigOverrides } from '../../src/config.js';
import { formatTime } from '../lib/frametime.js';
import { NumberField } from './NumberField.js';

export type PreviewSegment = 'intro' | 'flight' | 'outro';

interface OpeningEndingStripProps {
  introSec: number;
  outroSec: number;
  /** The flight length the intro and outro ease around. */
  flightSec: number;
  /** Whether the planner shortens both eases to fit the clip. */
  shortened: boolean;
  /** Which end of the flight the preview currently shows. */
  selected: PreviewSegment;
  onSelect: (segment: PreviewSegment) => void;
  onChange: (patch: ConfigOverrides) => boolean;
}

/**
 * The intro & outro strip: the structure bar names the three phases (its
 * segments also pick the preview frame, so both eases become visible), and
 * the steppers set the ease length on one baseline.
 */
export function OpeningEndingStrip({
  introSec,
  outroSec,
  flightSec,
  shortened,
  selected,
  onSelect,
  onChange,
}: OpeningEndingStripProps) {
  const t = useTranslation();
  const segments: ReadonlyArray<{ id: PreviewSegment; grow: number; label: string; accessible: string; hint: string }> = [
    {
      id: 'intro',
      grow: Math.max(introSec, 0.01),
      label: t('openingEndingStrip.introSegment'),
      accessible: t('openingEndingStrip.introAccessible'),
      hint: t('openingEndingStrip.previewIntro'),
    },
    {
      id: 'flight',
      grow: Math.max(flightSec, 0.01),
      label: t('openingEndingStrip.flightSegment', { duration: formatTime(flightSec) }),
      accessible: t('openingEndingStrip.flightAccessible', { duration: formatTime(flightSec) }),
      hint: t('openingEndingStrip.previewFlight'),
    },
    {
      id: 'outro',
      grow: Math.max(outroSec, 0.01),
      label: t('openingEndingStrip.outroSegment'),
      accessible: t('openingEndingStrip.outroAccessible'),
      hint: t('openingEndingStrip.previewOutro'),
    },
  ];
  return (
    <fieldset className="settings-group opening-ending">
      <legend>{t('openingEndingStrip.introOutro')}</legend>
      <div className="structure-bar" role="group" aria-label={t('openingEndingStrip.flightStructure')}>
        {segments.map(({ id, grow, label, accessible, hint }) => (
          <button
            key={id}
            type="button"
            className={`structure-seg structure-seg-${id}`}
            style={{ flexGrow: grow }}
            aria-pressed={selected === id}
            aria-label={accessible}
            title={hint}
            onClick={() => onSelect(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="opening-ending-steppers">
        <NumberField
          label={t('openingEndingStrip.introLength')}
          value={introSec}
          min={0}
          step={0.5}
          rule={t('openingEndingStrip.minimumDuration')}
          unit={t('openingEndingStrip.s')}
          onValue={(introSec) => onChange({ introSec })}
        />
        <p className="hint">{t('openingEndingStrip.durationHint')}</p>
        <NumberField
          label={t('openingEndingStrip.outroLength')}
          value={outroSec}
          min={0}
          step={0.5}
          rule={t('openingEndingStrip.minimumDuration')}
          unit={t('openingEndingStrip.s')}
          onValue={(outroSec) => onChange({ outroSec })}
        />
      </div>
      {shortened ? <p className="hint">{t('openingEndingStrip.shortened')}</p> : null}
    </fieldset>
  );
}
