import type { RenderProfile } from '../src/encode.js';
import type { RenderJobOptions } from '../src/render.js';
import type { CaptureSession, CaptureSessionSpec } from './electron-session.mjs';

export interface ElectronRenderVideoOptions {
  /** Capture seam; defaults to the Electron BrowserWindow session. */
  openSession?: (spec: CaptureSessionSpec) => Promise<CaptureSession>;
}

/** A PipelineDeps['renderVideo'] implementation for the desktop app. */
export function createElectronRenderVideo(
  options?: ElectronRenderVideoOptions,
): (opts: RenderJobOptions) => Promise<{ profile: RenderProfile }>;
