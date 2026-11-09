'use client';

import { ErrorNotice } from './ErrorNotice.js';

export interface ExportErrorProps {
  error: string;
  onClose: () => void;
}

export function ExportError({ error, onClose }: ExportErrorProps) {
  return (
    <>
      <ErrorNotice message={error} tail="The destination file was left untouched." />
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
