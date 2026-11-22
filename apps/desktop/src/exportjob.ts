import path from 'node:path';

import type { ExportRequest } from 'drone-path-engine/config';
import { errorMessage } from 'drone-path-core/errors';
import { classifyError, codedDesktopError } from 'drone-path-desktop/shared/errors';
import type { ExportOutcome } from 'drone-path-desktop/shared/ipc';
import { samePath, uniquePath } from 'drone-path-engine/paths';
import type { CaptureProgress } from 'drone-path-engine/render';
import { processRecording } from 'drone-path-engine/pipeline';
import type { LogFn } from 'drone-path-engine/logging';
import type { PipelineDeps, RecordingSummary } from 'drone-path-engine/pipeline';

export type { ExportOutcome };

export type RunExportJobFn = (
  videoPath: string,
  request: ExportRequest,
  log: LogFn,
  workingPath: string,
  signal: AbortSignal,
  onCapture?: (progress: CaptureProgress) => void,
) => Promise<RecordingSummary>;

export interface ExportIo {
  exists(filePath: string): boolean;
  remove(filePath: string): void;
  rename(from: string, to: string): void;
}

const runViaPipeline =
  (deps: Partial<PipelineDeps> | undefined): RunExportJobFn =>
  (videoPath, request, log, workingPath, signal, onCapture) =>
    processRecording(videoPath, request.config, log, workingPath, {
      range: request.range ?? undefined,
      signal,
      onCapture,
      deps,
    });

export interface ExportRunnerOptions {
  io: ExportIo;
  log?: LogFn;
  onDone: (outcome: ExportOutcome) => void;
  onCapture?: (progress: CaptureProgress) => void;
  run?: RunExportJobFn;
  deps?: Partial<PipelineDeps>;
}

export interface ExportRunner {
  start(videoPath: string, request: ExportRequest): void;
  cancel(): void;
  running(): boolean;
}

// The working file keeps the .mp4 suffix: ffmpeg infers the container from it.
function workingPathFor(outPath: string, exists: ExportIo['exists']): string {
  const dir = path.dirname(outPath);
  const stem = `${path.basename(outPath, path.extname(outPath))}.partial`;
  return uniquePath(dir, stem, '.mp4', exists);
}

function removeQuietly(working: string, remove: ExportIo['remove']): void {
  try {
    remove(working);
  } catch {
    // best-effort removal; a cleanup failure must never throw from here
  }
}

function swapIntoPlace(working: string, outPath: string, rename: ExportIo['rename']): void {
  try {
    rename(working, outPath);
  } catch (e) {
    throw codedDesktopError(
      'COULD_NOT_REPLACE_OUTPUT',
      `could not replace ${outPath}: ${errorMessage(e)} (the finished render is at ${working})`,
      { path: working },
      e,
    );
  }
}

export function createExportRunner(options: ExportRunnerOptions): ExportRunner {
  const { io } = options;
  const log = options.log ?? ((): void => {});
  const run = options.run ?? runViaPipeline(options.deps);
  let job: { abort: () => void } | null = null;

  async function execute(
    videoPath: string,
    request: ExportRequest,
    working: string,
    controller: AbortController,
  ): Promise<ExportOutcome> {
    let summary: RecordingSummary;
    try {
      summary = await run(videoPath, request, log, working, controller.signal, options.onCapture);
    } catch (e) {
      removeQuietly(working, io.remove);
      return controller.signal.aborted
        ? { status: 'canceled' }
        : { status: 'error', ...classifyError(e) };
    }
    if (controller.signal.aborted) {
      removeQuietly(working, io.remove);
      return { status: 'canceled' };
    }
    try {
      swapIntoPlace(working, request.outPath, io.rename);
    } catch (e) {
      return { status: 'error', ...classifyError(e) };
    }
    log(`exported: ${request.outPath}`);
    return { status: 'ok', summary: { ...summary, out: request.outPath } };
  }

  return {
    start(videoPath: string, request: ExportRequest): void {
      if (job) {
        throw codedDesktopError('EXPORT_ALREADY_RUNNING', 'an export is already running');
      }
      if (!path.isAbsolute(request.outPath)) {
        throw codedDesktopError('OUTPUT_PATH_ABSOLUTE', `output path must be absolute: ${request.outPath}`);
      }
      if (samePath(request.outPath, videoPath)) {
        throw codedDesktopError(
          'OUTPUT_OVERWRITES_SOURCE',
          'the output must not overwrite the source recording',
        );
      }
      const controller = new AbortController();
      job = { abort: () => controller.abort() };
      const working = workingPathFor(request.outPath, io.exists);
      // The catch guards a consumer's throwing onDone: an unhandled rejection here would kill the process.
      void execute(videoPath, request, working, controller)
        .then((outcome) => {
          job = null;
          options.onDone(outcome);
        })
        .catch((e: unknown) => {
          job = null;
          log(`export completion failed: ${errorMessage(e)}`);
        });
    },
    cancel(): void {
      job?.abort();
    },
    running(): boolean {
      return job !== null;
    },
  };
}
