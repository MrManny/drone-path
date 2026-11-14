// The desktop app's renderVideo: the same overlay page and the same ffmpeg
// encode step as the CLI, captured through the app's embedded Chromium
// (./electron-session.mjs) instead of playwright-core, which packaged builds
// deliberately exclude. Injected through PipelineDeps.renderVideo where
// main.mjs builds the export runner, so development and packaged builds run
// the identical path.

import { finishEncode, formatProfile, OrderedFrameStream, spawnEncoder } from '../dist/encode.js';
import { ERR_RENDER_CANCELED } from '../dist/errors.js';
import { startRenderServer } from '../dist/serve.js';
import { openElectronSession } from './electron-session.mjs';

// One job per stage, mirroring the CLI renderer's flow so both backends keep
// the same contract: same log lines, same progress cadence, same encode.
async function captureFrame(run, loop, session, idx) {
  const evalStart = Date.now();
  await session.setFrame(run.frameStart + idx);
  run.timing.evalMs += Date.now() - evalStart;

  const captureStart = Date.now();
  const buf = await session.capture();
  run.timing.captureMs += Date.now() - captureStart;

  const done = ++loop.capturesDone;

  const emitStart = Date.now();
  await run.stream.submit(idx, buf);
  run.timing.emitMs += Date.now() - emitStart;

  if (done % 100 === 0 || done === run.frames) {
    run.log(`frames: ${done}/${run.frames} captured`);
    run.onCapture?.({ done, total: run.frames });
  }
}

async function workerLoop(run, loop, workerId) {
  const session = await run.openSession({
    url: run.url,
    width: run.width,
    height: run.height,
    capture: run.capture,
  });
  try {
    for (;;) {
      if (loop.failed) return;
      if (run.signal?.aborted) throw new Error(ERR_RENDER_CANCELED);
      const idx = loop.cursor++;
      if (idx >= run.frames) break;
      await captureFrame(run, loop, session, idx);
    }
  } finally {
    await session.close().catch(() => {});
  }
  run.log(`worker ${workerId} done`);
}

async function runWorkers(run, workerCount) {
  const loop = { cursor: 0, capturesDone: 0, failed: false };
  const settled = await Promise.allSettled(
    Array.from({ length: workerCount }, (_, i) =>
      workerLoop(run, loop, i + 1).catch((e) => {
        loop.failed = true;
        throw e;
      }),
    ),
  );
  const rejected = settled.find((r) => r.status === 'rejected');
  if (rejected) throw rejected.reason;
}

async function captureAndEncode(run, workerCount) {
  const { fpsStr, codec, quality, preset, outPath, signal, log, tools } = run;
  const encoder = spawnEncoder(tools.ffmpeg, fpsStr, { codec, quality, preset }, outPath);
  const killOnAbort = () => encoder.kill();
  signal?.addEventListener('abort', killOnAbort, { once: true });
  const stream = new OrderedFrameStream(encoder);
  try {
    await runWorkers({ ...run, stream }, workerCount);
    await finishEncode(encoder, stream, log, outPath);
  } catch (e) {
    encoder.kill();
    throw e;
  } finally {
    signal?.removeEventListener('abort', killOnAbort);
  }
}

function reportProfile(run, timing, workerCount) {
  const profile = {
    evalMs: Math.round(timing.evalMs),
    captureMs: Math.round(timing.captureMs),
    emitMs: Math.round(timing.emitMs),
  };
  run.log(formatProfile(profile, workerCount));
  return { profile };
}

export function createElectronRenderVideo(options = {}) {
  const openSession = options.openSession ?? openElectronSession;

  return async function renderVideo(opts) {
    const {
      html, style, tileCache, width, height, frames, fpsStr,
      workers, outPath, log = () => {}, browserPath = null,
      tools,
      capture = 'jpeg', codec = 'h264', quality = 'high', preset = 'medium',
      frameStart = 0, signal,
      onCapture,
    } = opts;

    // A browser path is a CLI concern; the app always renders with its own
    // embedded Chromium, so say so instead of silently dropping the setting.
    if (browserPath) {
      log(`browser: ${browserPath} is ignored (the app renders with its embedded Chromium)`);
    }
    log('capture: electron (embedded Chromium)');
    if (signal?.aborted) throw new Error(ERR_RENDER_CANCELED);

    const workerCount = Math.max(1, Math.min(workers, frames));
    const run = {
      width,
      height,
      frames,
      frameStart,
      fpsStr,
      outPath,
      capture,
      codec,
      quality,
      preset,
      signal,
      log,
      onCapture,
      tools,
      openSession,
    };
    const timing = { evalMs: 0, captureMs: 0, emitMs: 0 };
    const { server, url } = await startRenderServer({ html, style, tileCache });
    try {
      await captureAndEncode({ ...run, url, timing }, workerCount);
    } finally {
      server.close();
    }

    return reportProfile(run, timing, workerCount);
  };
}
