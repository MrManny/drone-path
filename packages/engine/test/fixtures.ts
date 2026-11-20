import { DEFAULT_CONFIG } from '../src/config.js';
import type { RenderConfig } from '../src/config.js';
import type { VideoProbe } from 'drone-path-core/ffmpeg';
import type { PipelineDeps } from '../src/pipeline.js';
import type { Telemetry } from 'drone-path-core/telemetry-math';
import type { RecordingTelemetry } from 'drone-path-core/telemetry';
import { loadedTelemetry, probeFixture, telemetryFixture, tmpDir } from '../../core/test/fixtures.js';

type StubDepsOptions = Partial<PipelineDeps> & {
  probe?: VideoProbe;
  telemetry?: Telemetry;
  loaded?: RecordingTelemetry;
};

export function stubDeps(options: StubDepsOptions = {}): PipelineDeps {
  const {
    probe = probeFixture(),
    telemetry = telemetryFixture(),
    loaded = loadedTelemetry({ telemetry }),
    ...overrides
  } = options;
  return {
    probeVideo: async () => probe,
    loadTelemetry: async () => loaded,
    prefetchTiles: async () => ({ downloaded: 2, failed: 1, total: 5 }),
    renderVideo: async () => ({ profile: { evalMs: 10, captureMs: 20, emitMs: 30 } }),
    verifyOutput: async () => ({ frames: probe.frames, fps: probe.fps.str, ok: true }),
    outputMatchesSource: async () => false,
    ...overrides,
  };
}

export function testConfig(overrides: Partial<RenderConfig> = {}): RenderConfig {
  return {
    ...DEFAULT_CONFIG,
    outDir: tmpDir(),
    tileCache: tmpDir(),
    ...overrides,
  };
}

/** Odd dimensions and the even canvas every config entry point normalizes to. */
export const ODD_DIMENSIONS = {
  input: { width: 641, height: 767 },
  even: { width: 640, height: 766 },
} as const;
