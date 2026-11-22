// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotice } from '../../ui/components/ErrorNotice.js';

afterEach(cleanup);

describe('ErrorNotice', () => {
  it('turns a known structured error into its sentence and keeps the detail as technical details', () => {
    render(
      <ErrorNotice
        error={{
          code: 'FS_EXISTS',
          params: { name: 'blocked-folder' },
          detail: "EEXIST: file already exists, mkdir '/exports/blocked-folder'",
        }}
      />,
    );
    expect(
      screen.getByText('A file named "blocked-folder" is in the way. Choose another folder or file name.'),
    ).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText("EEXIST: file already exists, mkdir '/exports/blocked-folder'")).toBeTruthy();
  });

  it('never surfaces raw backend text in the lead for an uncataloged backend error', () => {
    render(
      <ErrorNotice
        error={{ code: 'BACKEND_ERROR', detail: 'the app backend went away' }}
      />,
    );
    expect(screen.getByText('The action could not be completed. Try again.')).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(screen.getByText('BACKEND_ERROR: the app backend went away')).toBeTruthy();
  });

  it('prefixes the lead sentence like the Open flow does', () => {
    render(
      <ErrorNotice
        error={{ code: 'NO_RECORDING', detail: 'no recording loaded' }}
        lead="Could not open the recording:"
      />,
    );
    expect(
      screen.getByText('Could not open the recording: No recording is loaded. Open a recording first.'),
    ).toBeTruthy();
  });

  it('announces as an alert', () => {
    render(<ErrorNotice error={{ code: 'UNKNOWN', detail: 'boom' }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('calls onDismiss from its Dismiss button', () => {
    const onDismiss = vi.fn();
    render(<ErrorNotice error={{ code: 'UNKNOWN', detail: 'boom' }} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has no Dismiss button when nothing can dismiss it', () => {
    render(<ErrorNotice error={{ code: 'UNKNOWN', detail: 'boom' }} />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });
});
