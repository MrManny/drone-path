import type { Readable, Writable } from 'node:stream';

import { McpServer as SdkMcpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { archiveDbPath } from 'drone-path-archive/paths';
import { errorMessage } from 'drone-path-core/errors';
import { requireFfmpegTools } from 'drone-path-core/ffmpeg';
import { resolveFfmpegTools } from 'drone-path-core/ffmpeg-tools';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import type { LogFn } from 'drone-path-engine/logging';
import { runBatch } from 'drone-path-engine/pipeline';

import { resolveAllowedRoots } from './mcp-paths.js';
import { registerMcpTools, sanitizeMcpErrorMessage } from './mcp-tools.js';
import { VERSION } from './version.js';

export interface McpServerOptions {
  archiveDb?: string;
  allowedRoots?: readonly string[];
  input?: Readable;
  output?: Writable;
  log?: LogFn;
  tools?: FfmpegToolPaths;
  getTools?: () => Promise<FfmpegToolPaths>;
  runBatch?: typeof runBatch;
}

export interface McpServer {
  readonly archiveDb: string;
  readonly allowedRoots: readonly string[];
  start: () => Promise<void>;
  close: () => Promise<void>;
}

function defaultLogger(): LogFn {
  return (msg: string) => {
    process.stderr.write(`[drone-path] ${msg}\n`);
  };
}

function createGetTools(options: McpServerOptions): () => Promise<FfmpegToolPaths> {
  if (options.getTools) return options.getTools;
  let cached: Promise<FfmpegToolPaths> | null = null;
  return () => {
    cached ??= (async () => {
      if (options.tools) return options.tools;
      const resolved = resolveFfmpegTools({ ffmpeg: null, ffprobe: null });
      await requireFfmpegTools(resolved);
      return resolved;
    })().catch((err) => {
      cached = null;
      throw err;
    });
    return cached;
  };
}

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const archiveDb = archiveDbPath(options.archiveDb);
  const allowedRoots = resolveAllowedRoots(options.allowedRoots);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const log = options.log ?? defaultLogger();

  const sdkServer = new SdkMcpServer(
    { name: 'drone-path', version: VERSION },
    { capabilities: { tools: {} } },
  );
  sdkServer.server.onerror = (err) => {
    log(`mcp error: ${sanitizeMcpErrorMessage(errorMessage(err))}`);
  };

  registerMcpTools(sdkServer, {
    archiveDb,
    allowedRoots,
    getTools: createGetTools(options),
    runBatch: options.runBatch ?? runBatch,
    log,
  });

  let started = false;
  let closeResolve: (() => void) | null = null;

  async function start(): Promise<void> {
    if (started) {
      throw new Error('mcp server is already started');
    }
    started = true;
    const transport = new StdioServerTransport(input, output);
    const closed = new Promise<void>((resolve) => {
      closeResolve = resolve;
    });
    const prevOnClose = sdkServer.server.onclose;
    sdkServer.server.onclose = () => {
      prevOnClose?.();
      started = false;
      const done = closeResolve;
      closeResolve = null;
      done?.();
    };

    try {
      await sdkServer.connect(transport);
    } catch (err) {
      started = false;
      const done = closeResolve;
      closeResolve = null;
      done?.();
      throw err;
    }

    await closed;
  }

  async function close(): Promise<void> {
    await sdkServer.close();
    started = false;
    const done = closeResolve;
    closeResolve = null;
    done?.();
  }

  return {
    archiveDb,
    allowedRoots,
    start,
    close,
  };
}
