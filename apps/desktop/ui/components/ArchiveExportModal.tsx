'use client';

import { useId, useState } from 'react';

import { classifyError, fromIpcFailure } from '../../shared/errors.js';
import type { StructuredError } from '../../shared/errors.js';
import { ARCHIVE_EXPORT_FORMATS } from '../../shared/ipc.js';
import type { ArchiveExportFormat, ArchiveQueryFilters } from '../lib/backend.js';
import { appBridge } from '../lib/backend.js';
import { useTranslation } from '../lib/i18n.js';
import { DialogShell } from './DialogShell.js';
import { ErrorNotice } from './ErrorNotice.js';

export interface ArchiveExportModalProps {
  filters?: ArchiveQueryFilters;
  hasActiveFilters: boolean;
  onClose: () => void;
}

const DEFAULT_REDACT_METERS = 500;

function formatFromPath(filePath: string, fallback: ArchiveExportFormat): ArchiveExportFormat {
  const match = /\.([^.\\/]+)$/.exec(filePath);
  const ext = match ? match[1].toLowerCase() : '';
  return ARCHIVE_EXPORT_FORMATS.find((candidate) => candidate === ext) ?? fallback;
}

export function ArchiveExportModal({
  filters,
  hasActiveFilters,
  onClose,
}: ArchiveExportModalProps) {
  const t = useTranslation();
  const baseId = useId();
  const formatId = `${baseId}-format`;
  const redactInputId = `${baseId}-redact-m`;

  const [format, setFormat] = useState<ArchiveExportFormat>('gpx');
  const [redactEnabled, setRedactEnabled] = useState(false);
  const [redactInput, setRedactInput] = useState(String(DEFAULT_REDACT_METERS));
  const [includeGaze, setIncludeGaze] = useState(true);
  const [offline, setOffline] = useState(false);
  const [phase, setPhase] = useState<'form' | 'exporting' | 'done'>('form');
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [error, setError] = useState<StructuredError | null>(null);

  const parsedRedact = Number(redactInput);
  const redactValid =
    !redactEnabled || (Number.isFinite(parsedRedact) && parsedRedact > 0);

  const formatLabels: Record<ArchiveExportFormat, string> = {
    gpx: t('archiveExportModal.formatGpx'),
    geojson: t('archiveExportModal.formatGeojson'),
    kml: t('archiveExportModal.formatKml'),
    kmz: t('archiveExportModal.formatKmz'),
    html: t('archiveExportModal.formatHtml'),
  };

  async function handleStartExport(): Promise<void> {
    if (!redactValid || phase === 'exporting') return;
    setError(null);
    try {
      const bridge = appBridge();
      const pick = await bridge.pickArchiveExportOutput(format);
      if (!pick.ok) {
        if (!pick.canceled) setError(fromIpcFailure(pick));
        return;
      }

      const targetFormat = formatFromPath(pick.path, format);
      setPhase('exporting');
      const result = await bridge.exportArchive({
        outPath: pick.path,
        format: targetFormat,
        ...(filters ? { filters } : {}),
        ...(redactEnabled ? { redactLaunchM: parsedRedact } : {}),
        ...(targetFormat === 'html'
          ? { includeGaze: includeGaze && !redactEnabled, offline }
          : {}),
      });
      if (!result.ok) {
        setError(fromIpcFailure(result));
        setPhase('form');
        return;
      }
      setExportedPath(pick.path);
      setPhase('done');
    } catch (e) {
      setError(classifyError(e));
      setPhase('form');
    }
  }

  async function handleReveal(): Promise<void> {
    if (!exportedPath) return;
    setError(null);
    try {
      const result = await appBridge().revealExportOutput({ out: exportedPath });
      if (!result.ok) setError(fromIpcFailure(result));
    } catch (e) {
      setError(classifyError(e));
    }
  }

  const busy = phase === 'exporting';

  return (
    <DialogShell
      title={t('archiveExportModal.title')}
      panelClass="archive-export-panel"
      onClose={onClose}
      closeOnBackdrop={!busy}
      blockedReason={busy ? t('archiveExportModal.busyClose') : undefined}
      focusKey={phase}
    >
      {phase === 'done' && exportedPath ? (
        <div>
          <p className="phase-status" role="status">
            {t('archiveExportModal.finished')}
          </p>
          {error ? <ErrorNotice error={error} /> : null}
          <p className="export-path" title={exportedPath}>
            {exportedPath}
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              {t('archiveExportModal.done')}
            </button>
            <button
              type="button"
              className="dialog-primary"
              data-phase-focus
              onClick={() => void handleReveal()}
            >
              {t('archiveExportModal.revealInFolder')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="archive-export-options">
            <div className="settings-row">
              <label className="settings-label" htmlFor={formatId}>
                {t('archiveExportModal.format')}
              </label>
              <select
                id={formatId}
                disabled={busy}
                value={format}
                onChange={(event) => setFormat(event.target.value as ArchiveExportFormat)}
              >
                {ARCHIVE_EXPORT_FORMATS.map((value) => (
                  <option key={value} value={value}>
                    {formatLabels[value]}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="settings-group">
              <legend>{t('archiveExportModal.privacyAndMap')}</legend>
              <label className="settings-row toggle-row">
                <input
                  type="checkbox"
                  className="toggle"
                  disabled={busy}
                  checked={redactEnabled}
                  onChange={(event) => setRedactEnabled(event.target.checked)}
                />
                <span>{t('archiveExportModal.redactLaunch')}</span>
              </label>
              {redactEnabled ? (
                <div className="settings-row">
                  <label className="settings-label" htmlFor={redactInputId}>
                    {t('archiveExportModal.redactRadius')}
                  </label>
                  <input
                    id={redactInputId}
                    type="number"
                    min={1}
                    step={50}
                    disabled={busy}
                    aria-invalid={!redactValid}
                    value={redactInput}
                    onChange={(event) => setRedactInput(event.target.value)}
                  />
                  <span className="field-unit">{t('archiveFilters.metersUnit')}</span>
                  {!redactValid ? (
                    <span className="field-message">
                      {t('field.mustBe', { rule: t('archiveExportModal.positiveMeters') })}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {format === 'html' ? (
                <>
                  <label className="settings-row toggle-row">
                    <input
                      type="checkbox"
                      className="toggle"
                      disabled={busy || redactEnabled}
                      checked={includeGaze && !redactEnabled}
                      onChange={(event) => setIncludeGaze(event.target.checked)}
                    />
                    <span>{t('archiveExportModal.includeGaze')}</span>
                  </label>
                  <label className="settings-row toggle-row">
                    <input
                      type="checkbox"
                      className="toggle"
                      disabled={busy}
                      checked={offline}
                      onChange={(event) => setOffline(event.target.checked)}
                    />
                    <span>{t('archiveExportModal.offlineMap')}</span>
                  </label>
                </>
              ) : null}
            </fieldset>

            {hasActiveFilters ? (
              <p className="hint">{t('archiveExportModal.filteredNote')}</p>
            ) : null}
          </div>

          {error ? <ErrorNotice error={error} /> : null}

          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              {t('archiveExportModal.cancel')}
            </button>
            <button
              type="button"
              className="dialog-primary"
              data-phase-focus
              disabled={busy || !redactValid}
              onClick={() => void handleStartExport()}
            >
              {busy ? t('archiveExportModal.exporting') : t('archiveExportModal.startExport')}
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
}
