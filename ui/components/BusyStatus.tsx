import type { ReactNode } from 'react';

interface BusyStatusProps {
  children: ReactNode;
}

export function BusyStatus({ children }: BusyStatusProps) {
  return (
    <div className="busy-status" role="status">
      <span>{children}</span>
    </div>
  );
}
