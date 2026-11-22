'use client';

import { useTranslation } from '../lib/i18n.js';
import type { Codec, EncodeSettings, EncoderPreset, Quality } from 'drone-path-engine/config';
import type { FrameRange } from 'drone-path-core/frame-range';
import {
  CODEC_VALUES,
  MIN_DIMENSION,
  ENCODER_PRESET_VALUES,
  QUALITY_VALUES,
  isValidDimensions,
} from 'drone-path-engine/config';
import type { StructuredError } from '../../shared/errors.js';
import type { ExportEvent, ExportForm as ExportFormState } from '../lib/exportstate.js';
import { ErrorNotice } from './ErrorNotice.js';
import { Notice } from './Notice.js';
import { NumberField } from './NumberField.js';
import { SelectField } from './SelectField.js';

export interface ExportFormProps {
  form: ExportFormState;
  segment: { range: FrameRange; label: string } | null;
  totalText: string;
  encode: EncodeSettings;
  error: StructuredError | null;
  notice: string | null;
  dispatch: (event: ExportEvent) => void;
  onEncoderChange: (patch: Partial<EncodeSettings>) => void;
}

const CODEC_LABELS: Record<Codec, string> = {
  h264: 'H.264',
  h265: 'H.265',
};

export function ExportForm({
  form,
  segment,
  totalText,
  encode,
  error,
  notice,
  dispatch,
  onEncoderChange,
}: ExportFormProps) {
  const t = useTranslation();
  const qualities: Record<Quality, string> = {
    'near-lossless': t('exportForm.nearLossless'),
    high: t('exportForm.highQuality'),
    medium: t('exportForm.mediumQuality'),
    low: t('exportForm.lowQuality'),
  };
  const presets: Record<EncoderPreset, string> = {
    medium: t('exportForm.balanced'),
    veryfast: t('exportForm.faster'),
  };
  return (
    <>
      {segment ? (
        <fieldset className="settings-group">
          <legend>{t('exportForm.exportRange')}</legend>
          <div className="export-range">
            <label className="settings-row export-choice">
              <input
                type="radio"
                name="export-range"
                checked={form.range === null}
                onChange={() => dispatch({ type: 'setRange', range: null })}
              />
              <span>{t('exportForm.fullRecording', { duration: totalText })}</span>
            </label>
            <label className="settings-row export-choice">
              <input
                type="radio"
                name="export-range"
                checked={form.range !== null}
                onChange={() => dispatch({ type: 'setRange', range: segment.range })}
              />
              <span>{t('exportForm.inOutSegment', { range: segment.label })}</span>
            </label>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="settings-group">
        <legend>{t('exportForm.outputAndEncoding')}</legend>
        <div className="export-size">
          <NumberField
            label={t('exportForm.width')}
            value={form.width}
            min={MIN_DIMENSION}
            rule={t('exportForm.minimumDimension', { minimum: MIN_DIMENSION })}
            unit={t('exportForm.px')}
            onValue={(width) => {
              if (!isValidDimensions(width, form.height)) return false;
              dispatch({ type: 'setWidth', width });
              return true;
            }}
          />
          <NumberField
            label={t('exportForm.height')}
            value={form.height}
            min={MIN_DIMENSION}
            rule={t('exportForm.minimumDimension', { minimum: MIN_DIMENSION })}
            unit={t('exportForm.px')}
            onValue={(height) => {
              if (!isValidDimensions(form.width, height)) return false;
              dispatch({ type: 'setHeight', height });
              return true;
            }}
          />
        </div>
        <div className="export-encode">
          <SelectField
            label={t('exportForm.codec')}
            value={encode.codec}
            options={CODEC_VALUES.map((value) => ({ value, label: CODEC_LABELS[value] }))}
            onValue={(codec) => onEncoderChange({ codec: codec as Codec })}
          />
          <SelectField
            label={t('exportForm.quality')}
            value={encode.quality}
            options={QUALITY_VALUES.map((value) => ({ value, label: qualities[value] }))}
            onValue={(quality) => onEncoderChange({ quality: quality as Quality })}
          />
          <SelectField
            label={t('exportForm.encodingPreset')}
            value={encode.preset}
            options={ENCODER_PRESET_VALUES.map((value) => ({ value, label: presets[value] }))}
            onValue={(preset) => onEncoderChange({ preset: preset as EncoderPreset })}
          />
        </div>
      </fieldset>

      {error ? <ErrorNotice error={error} /> : null}
      {notice ? <Notice tone="info">{notice}</Notice> : null}
    </>
  );
}
