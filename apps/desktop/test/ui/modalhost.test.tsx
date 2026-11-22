// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from 'drone-path-engine/config';
import { ModalHost } from '../../ui/components/ModalHost.js';
import { useAppModals } from '../../ui/hooks/useAppModals.js';
import type { DialogEvent } from '../../ui/lib/dialogstate.js';
import { SESSION } from './harness.js';

vi.mock('../../ui/components/MapIsland.js', async () => {
  const { createFakeScene, immediateMapIslandMock } = await import('./harness.js');
  return immediateMapIslandMock(createFakeScene());
});

vi.mock('../../ui/components/ExportPreview.js', async () => {
  const { stubExportPreviewMock } = await import('./harness.js');
  return stubExportPreviewMock();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function HostHarness({
  onReady,
}: {
  onReady: (api: { open: (event: DialogEvent) => void; openExport: () => void }) => void;
}) {
  const modals = useAppModals();
  onReady({
    open: modals.dialogs.dispatchDialog,
    openExport: () => modals.openExport(DEFAULT_CONFIG, { in: null, out: null }, SESSION.video.frames),
  });
  return (
    <ModalHost
      modals={modals}
      session={SESSION}
      settings={DEFAULT_CONFIG}
      loop={{ in: null, out: null }}
      onSettingsChange={() => {}}
      language={{
        locale: 'en',
        preference: null,
        saving: false,
        error: false,
        selectLanguage: () => {},
      }}
    />
  );
}

describe('ModalHost', () => {
  it('renders nothing when closed and mounts only the active modal', () => {
    let api!: { open: (event: DialogEvent) => void; openExport: () => void };
    render(<HostHarness onReady={(next) => (api = next)} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => api.open({ type: 'openAbout' }));
    expect(screen.getByRole('dialog', { name: 'About' })).toBeTruthy();

    act(() => api.open({ type: 'openSettings' }));
    expect(screen.queryByRole('dialog', { name: 'About' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();

    act(() => api.openExport());
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Export video' })).toBeTruthy();
  });
});
