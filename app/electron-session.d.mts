import type { CaptureFormat } from '../src/config.js';

export interface CaptureSessionSpec {
  url: string;
  width: number;
  height: number;
  capture: CaptureFormat;
}

export interface CaptureSession {
  /** Advance the overlay page to a source frame and await its repaint. */
  setFrame(frame: number): Promise<void>;
  /** Capture the current frame as JPEG or PNG bytes, per the spec's format. */
  capture(): Promise<Buffer>;
  /** Release the underlying window; must never throw. */
  close(): Promise<void>;
}

export function openElectronSession(spec: CaptureSessionSpec): Promise<CaptureSession>;
