'use client';

export interface StatusBarProps {
  disabled?: boolean;
  hasTelemetry: boolean;
}

export function StatusBar({ disabled = false, hasTelemetry }: StatusBarProps) {
  return (
    <footer className="status-bar">
      {disabled ? (
        <span className="status-item">No recording loaded</span>
      ) : hasTelemetry ? (
        <span className="status-item">SRT telemetry loaded</span>
      ) : null}
    </footer>
  );
}
