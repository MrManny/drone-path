'use client';

import type { Codec, EncodeSettings, FrameRange, Preset, Quality } from '../../src/config.js';
import {
  CODEC_VALUES,
  MIN_DIMENSION,
  PRESET_VALUES,
  QUALITY_VALUES,
  validateDimensions,
} from '../../src/config.js';
import type { ExportEvent, ExportForm as ExportFormState } from '../lib/exportstate.js';
import { ErrorNotice } from './ErrorNotice.js';
import { NumberField } from './NumberField.js';
import { SelectField } from './SelectField.js';

export interface ExportFormProps {
  form: ExportFormState;
  /** The engaged loop's segment, or null while only the full recording exists. */
  segment: { range: FrameRange; label: string } | null;
  totalText: string;
  /** Encoder choices; the page persists them on change. */
  encode: EncodeSettings;
  error: string | null;
  dispatch: (event: ExportEvent) => void;
  onEncoderChange: (patch: Partial<EncodeSettings>) => void;
  onClose: () => void;
  onStart: () => void;
}

// The config vocabulary holds raw values; the options show plain words.
const CODEC_LABELS: Record<Codec, string> = {
  h264: 'H.264',
  h265: 'H.265',
};
const QUALITY_LABELS: Record<Quality, string> = {
  'near-lossless': 'Near-lossless',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const PRESET_LABELS: Record<Preset, string> = {
  medium: 'Balanced',
  veryfast: 'Faster',
};

// The modal's dimensions go through the same rule the CLI and pipeline apply.
function dimensionsValid(width: number, height: number): boolean {
  try {
    validateDimensions(width, height);
    return true;
  } catch {
    return false;
  }
}

export function ExportForm({
  form,
  segment,
  totalText,
  encode,
  error,
  dispatch,
  onEncoderChange,
  onClose,
  onStart,
}: ExportFormProps) {
  return (
    <>
      {/* With no engaged loop there is nothing to choose: the export is
          the full recording and the choice stays out of the way. */}
      {segment ? (
        <fieldset className="settings-group">
          <legend>What</legend>
          <label className="settings-row export-choice">
            <input
              type="radio"
              name="export-range"
              checked={form.range === null}
              onChange={() => dispatch({ type: 'setRange', range: null })}
            />
            <span>Full recording ({totalText})</span>
          </label>
          <label className="settings-row export-choice">
            <input
              type="radio"
              name="export-range"
              checked={form.range !== null}
              onChange={() => dispatch({ type: 'setRange', range: segment.range })}
            />
            <span>In–Out segment ({segment.label})</span>
          </label>
        </fieldset>
      ) : null}

      {/* The "How" legend names the pair with "What"; with no engaged loop
          there is no pair and the lone group needs no name. */}
      <fieldset className="settings-group">
        {segment ? <legend>How</legend> : null}
        <div className="export-size">
          <NumberField
            label="Width"
            value={form.width}
            min={MIN_DIMENSION}
            rule={`at least ${MIN_DIMENSION} px`}
            hint="px"
            onValue={(width) => {
              if (!dimensionsValid(width, form.height)) return false;
              dispatch({ type: 'setWidth', width });
              return true;
            }}
          />
          <NumberField
            label="Height"
            value={form.height}
            min={MIN_DIMENSION}
            rule={`at least ${MIN_DIMENSION} px`}
            hint="px"
            onValue={(height) => {
              if (!dimensionsValid(form.width, height)) return false;
              dispatch({ type: 'setHeight', height });
              return true;
            }}
          />
        </div>
        <div className="export-encode">
          <SelectField
            label="Format"
            value={encode.codec}
            options={CODEC_VALUES.map((value) => ({ value, label: CODEC_LABELS[value] }))}
            onValue={(codec) => onEncoderChange({ codec: codec as Codec })}
          />
          <SelectField
            label="Quality"
            value={encode.quality}
            options={QUALITY_VALUES.map((value) => ({ value, label: QUALITY_LABELS[value] }))}
            onValue={(quality) => onEncoderChange({ quality: quality as Quality })}
          />
          <SelectField
            label="Speed"
            value={encode.preset}
            options={PRESET_VALUES.map((value) => ({ value, label: PRESET_LABELS[value] }))}
            onValue={(preset) => onEncoderChange({ preset: preset as Preset })}
          />
        </div>
      </fieldset>

      {error ? <ErrorNotice message={error} /> : null}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="dialog-primary" onClick={onStart}>
          Start export
        </button>
      </div>
    </>
  );
}
