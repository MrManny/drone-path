'use client';

export interface ProgressBarProps {
  label: string;
  /** Known fraction percent, or null while no progress figure exists yet. */
  percent: number | null;
}

export function ProgressBar({ label, percent }: ProgressBarProps) {
  const determinate = percent !== null;
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      {...(determinate
        ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent }
        : {})}
    >
      <div
        className={determinate ? 'progress-fill' : 'progress-fill progress-shimmer'}
        style={determinate ? { width: `${percent}%` } : undefined}
      />
    </div>
  );
}
