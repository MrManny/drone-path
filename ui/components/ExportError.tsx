'use client';

import { ErrorNotice } from './ErrorNotice.js';

export interface ExportErrorProps {
  error: string;
}

export function ExportError({ error }: ExportErrorProps) {
  return <ErrorNotice message={error} tail="The destination file was left untouched." />;
}
