// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EncodeSettings } from '../../src/config.js';
import type { ExportFormProps } from '../../ui/components/ExportForm.js';
import { ExportForm } from '../../ui/components/ExportForm.js';
import type { ExportForm as ExportFormState } from '../../ui/lib/exportstate.js';

afterEach(cleanup);

const FORM: ExportFormState = { outPath: null, width: 768, height: 768, range: null };
const SEGMENT = { range: { start: 300, end: 360 }, label: '0:10–0:12 · 61 frames' };
const ENCODE: EncodeSettings = { codec: 'h264', quality: 'high', preset: 'medium' };

function renderForm(overrides: Partial<ExportFormProps> = {}) {
  const dispatch = overrides.dispatch ?? vi.fn();
  const onEncoderChange = overrides.onEncoderChange ?? vi.fn();
  render(
    <ExportForm
      form={FORM}
      segment={null}
      totalText="0:34"
      encode={ENCODE}
      error={null}
      onClose={vi.fn()}
      onStart={vi.fn()}
      {...overrides}
      dispatch={dispatch}
      onEncoderChange={onEncoderChange}
    />,
  );
  return { dispatch, onEncoderChange };
}

describe('ExportForm what-to-export choice', () => {
  it('stays out of the way without an engaged loop', () => {
    renderForm();
    expect(screen.queryByRole('group', { name: 'Export range' })).toBeNull();
  });

  it('offers the full recording and the segment with an engaged loop', () => {
    renderForm({ segment: SEGMENT });
    expect(screen.getByRole('radio', { name: /Full recording \(0:34\)/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /In–Out segment \(0:10–0:12 · 61 frames\)/ })).toBeTruthy();
  });

  it('reports the segment choice back to the form state', () => {
    const { dispatch } = renderForm({ segment: SEGMENT });
    fireEvent.click(screen.getByRole('radio', { name: /In–Out segment/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setRange', range: SEGMENT.range });
  });

  it('reports the full-recording choice back to the form state', () => {
    const { dispatch } = renderForm({
      segment: SEGMENT,
      form: { ...FORM, range: SEGMENT.range },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Full recording/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'setRange', range: null });
  });

  it('needs no group legend without a choice to make', () => {
    renderForm();
    expect(screen.queryByRole('group', { name: 'How' })).toBeNull();
  });

  it('names both groups when the loop offers a choice', () => {
    renderForm({ segment: SEGMENT });
    expect(screen.getByRole('group', { name: 'Export range' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'How' })).toBeTruthy();
  });
});

describe('ExportForm dimensions', () => {
  it('shows the px hint on both fields', () => {
    renderForm();
    expect(screen.getByLabelText('Width')).toBeTruthy();
    expect(screen.getByLabelText('Height')).toBeTruthy();
    expect(screen.getAllByText('px')).toHaveLength(2);
  });

  it('commits a valid width through the dispatch', () => {
    const { dispatch } = renderForm();
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '800' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'setWidth', width: 800 });
    expect(screen.queryByText('Must be at least 64 px.')).toBeNull();
  });

  it('rejects a width below the minimum with the rule message', () => {
    const { dispatch } = renderForm();
    const width = screen.getByLabelText<HTMLInputElement>('Width');
    fireEvent.change(width, { target: { value: '10' } });
    expect(screen.getByText('Must be at least 64 px.')).toBeTruthy();
    expect(width.getAttribute('aria-invalid')).toBe('true');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('ExportForm encoding', () => {
  it('shows the encoder vocabulary values in plain words', () => {
    renderForm({ encode: { codec: 'h265', quality: 'low', preset: 'veryfast' } });
    expect(screen.getByLabelText<HTMLSelectElement>('Format').value).toBe('h265');
    expect(screen.getByLabelText<HTMLSelectElement>('Quality').value).toBe('low');
    expect(screen.getByLabelText<HTMLSelectElement>('Speed').value).toBe('veryfast');
    expect(screen.getByRole('option', { name: 'H.265' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Near-lossless' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Balanced' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Faster' })).toBeTruthy();
  });

  it('reports each change back as vocabulary values', () => {
    const { onEncoderChange } = renderForm();
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'h265' } });
    expect(onEncoderChange).toHaveBeenLastCalledWith({ codec: 'h265' });
    fireEvent.change(screen.getByLabelText('Quality'), { target: { value: 'near-lossless' } });
    expect(onEncoderChange).toHaveBeenLastCalledWith({ quality: 'near-lossless' });
    fireEvent.change(screen.getByLabelText('Speed'), { target: { value: 'veryfast' } });
    expect(onEncoderChange).toHaveBeenLastCalledWith({ preset: 'veryfast' });
  });
});

describe('ExportForm actions', () => {
  it('offers Cancel and Start export', () => {
    const onClose = vi.fn();
    const onStart = vi.fn();
    renderForm({ onClose, onStart });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows a failure message above the actions', () => {
    renderForm({ error: 'the app backend went away' });
    expect(screen.getByText('the app backend went away')).toBeTruthy();
  });
});

describe('ExportForm scan hierarchy', () => {
  it('runs the output-size fields above the encoding controls', () => {
    renderForm({ segment: SEGMENT });
    const how = screen.getByRole('group', { name: 'How' });
    const labels = [...how.querySelectorAll('.settings-label')].map((el) => el.textContent);
    expect(labels).toEqual(['Width', 'Height', 'Format', 'Quality', 'Speed']);
  });

  it('renders the range choices as one choice set', () => {
    renderForm({ segment: SEGMENT });
    const range = screen.getByRole('group', { name: 'Export range' });
    expect(range.querySelectorAll('.export-range')).toHaveLength(1);
    const container = range.querySelector('.export-range') as HTMLElement;
    expect(container.querySelectorAll('.export-choice')).toHaveLength(2);
    const how = screen.getByRole('group', { name: 'How' });
    expect(how.querySelectorAll('.export-size .settings-row')).toHaveLength(2);
    expect(how.querySelectorAll('.export-encode .settings-row')).toHaveLength(3);
  });
});
