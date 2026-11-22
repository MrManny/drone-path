import type { FrameRange } from 'drone-path-core/frame-range';
import type { Bbox } from 'drone-path-core/geo';
import type { AppearanceSettings } from 'drone-path-engine/config';
import type { RecordingSummary } from 'drone-path-engine/pipeline';
import type { SceneData } from 'drone-path-engine/renderer/scene';

export interface PageVideo {
  src: string;
  fps: number;
  frames: number;
  width: number;
  height: number;
}

export interface UiSession {
  scene: SceneData;
  video: PageVideo;
  tileBase: string;
  bbox: Bbox;
  durationSec: number;
}

export interface IpcResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
}

export type PickResult = IpcResult;

export interface PickRequest {
  settings: AppearanceSettings;
}

export interface TrackSaveRequest {
  outPath: string;
  range: FrameRange | null;
}

export type ExportOutcome =
  | { status: 'ok'; summary: RecordingSummary }
  | { status: 'error'; error: string }
  | { status: 'canceled' };
