import fs from 'node:fs';
import path from 'node:path';

import type { ExportRequest } from './config.js';
import {
  ERR_COULD_NOT_REPLACE,
  ERR_EXPORT_ALREADY_RUNNING,
  ERR_OUTPUT_OVERWRITES_SOURCE,
  ERR_OUTPUT_PATH_ABSOLUTE,
  ERR_RENDER_KEPT_AT,
  errorMessage,
} from './errors.js';
import { samePath, uniquePath } from './paths.js';
import type { CaptureProgress } from './render.js';
import { processRecording } from './pipeline.js';
import type { LogFn } from './logging.js';
import type { PipelineDeps, RecordingSummary } from './pipeline.js';

export type ExportOutcome =
  | { status: 'ok'; summary: RecordingSummary }
  | { status: 'error'; error: string }
  | { status: 'canceled' };

export type RunExportJobFn = (
  videoPath: string,
  request: ExportRequest,
  log: LogFn,
  workingPath: string,
  signal: AbortSignal,
  onCapture?: (progress: CaptureProgress) => void,
) => Promise<RecordingSummary>;

const runViaPipeline =
  (deps: Partial<PipelineDeps> | undefined): RunExportJobFn =>
  (videoPath, request, log, workingPath, signal, onCapture) =>
    processRecording(videoPath, request.config, log, workingPath, {
      range: request.range ?? undefined,
      signal,
      onCapture,
      deps,
    });

interface ExportRunnerOptions {
  log?: LogFn;
  onDone: (outcome: ExportOutcome) => void;
  onCapture?: (progress: CaptureProgress) => void;
  run?: RunExportJobFn;
  deps?: Partial<PipelineDeps>;
}

interface ExportRunner {
  start(videoPath: string, request: ExportRequest): void;
  cancel(): void;
  running(): boolean;
}

// The working file keeps the .mp4 suffix: ffmpeg infers the container from it.
function workingPathFor(outPath: string): string {
  const dir = path.dirname(outPath);
  const stem = `${path.basename(outPath, path.extname(outPath))}.partial`;
  return uniquePath(dir, stem, '.mp4', (candidate) => fs.existsSync(candidate));
}

function removeQuietly(working: string): void {
  try {
    fs.rmSync(working, { force: true });
  } catch {
    // best-effort removal; a cleanup failure must never throw from here
  }
}

function swapIntoPlace(working: string, outPath: string): void {
  try {
    fs.renameSync(working, outPath);
  } catch (e) {
    throw new Error(
      `${ERR_COULD_NOT_REPLACE}${outPath}: ${errorMessage(e)} ` +
        `(${ERR_RENDER_KEPT_AT}${working})`,
      { cause: e },
    );
  }
}

export function createExportRunner(options: ExportRunnerOptions): ExportRunner {
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
      removeQuietly(working);
      return controller.signal.aborted
        ? { status: 'canceled' }
        : { status: 'error', error: errorMessage(e) };
    }
    try {
      swapIntoPlace(working, request.outPath);
    } catch (e) {
      return { status: 'error', error: errorMessage(e) };
    }
    log(`exported: ${request.outPath}`);
    return { status: 'ok', summary: { ...summary, out: request.outPath } };
  }

  return {
    start(videoPath: string, request: ExportRequest): void {
      if (job) throw new Error(ERR_EXPORT_ALREADY_RUNNING);
      if (!path.isAbsolute(request.outPath)) {
        throw new Error(`${ERR_OUTPUT_PATH_ABSOLUTE}${request.outPath}`);
      }
      if (samePath(request.outPath, videoPath)) {
        throw new Error(ERR_OUTPUT_OVERWRITES_SOURCE);
      }
      const controller = new AbortController();
      job = { abort: () => controller.abort() };
      const working = workingPathFor(request.outPath);
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
