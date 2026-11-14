import fs from 'node:fs';
import { Command, Option } from 'commander';

import { ERROR_PREFIX, errorMessage } from './errors.js';
import { VERSION } from './version.js';
import {
  CONFIG_FILE_OPTION,
  CONFIG_OPTIONS,
  OVERRIDE_NORMALIZERS,
  TELEMETRY_JSON_ALIAS,
  cliDefaultOf,
} from './config.js';
import { resolveConfig } from './configfile.js';
import type { ConfigOverrides, RenderConfig, TrackOutSpelling } from './config.js';
import { collectRecordings } from './recordings.js';
import { requireFfmpegTools } from './ffmpeg.js';
import { resolveFfmpegTools } from './ffmpeg-tools.js';
import { runBatch } from './pipeline.js';
import type { LogFn } from './logging.js';
import type { RecordingSummary } from './pipeline.js';

export interface ParsedCli {
  inputs: string[];
  cli: ConfigOverrides;
  trackOutSpelling: TrackOutSpelling | null;
  configPath: string | null;
  deprecationWarnings: string[];
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('drone-path')
    .description(
      'Render flight-path map overlay videos from DJI drone recordings (telemetry ' +
        'from the embedded CAM-meta stream or the .SRT sidecar) at exactly the source ' +
        'frame rate and frame count.',
    )
    .version(VERSION)
    .argument(
      '<inputs...>',
      'video files and/or folders (folders are scanned for *.mp4)',
    );
  for (const row of CONFIG_OPTIONS) {
    const option = new Option(row.cli.flags, row.cli.help);
    if (row.cli.choices) option.choices([...row.cli.choices]);
    const defaultValue = cliDefaultOf(row.key);
    if (defaultValue !== '') option.default(defaultValue);
    program.addOption(option);
  }
  program.addOption(new Option(TELEMETRY_JSON_ALIAS.flags, TELEMETRY_JSON_ALIAS.help));
  program.option(CONFIG_FILE_OPTION.flags, CONFIG_FILE_OPTION.help);
  return program;
}

function givenOnCommandLine(
  program: Command,
  name: string,
): boolean {
  return program.getOptionValueSource(name) === 'cli';
}

export function longFlagOf(flags: string): string {
  const tokens = flags.split(/[ ,|]+/);
  return tokens.find((token) => token.startsWith('--')) ?? tokens[0];
}

function collectOverrides(
  program: Command,
  onDeprecated: (message: string) => void,
): { cli: ConfigOverrides; trackOutSpelling: TrackOutSpelling | null } {
  const opts = program.opts<Record<string, unknown>>();
  const cli: ConfigOverrides = {};
  for (const row of CONFIG_OPTIONS) {
    if (!givenOnCommandLine(program, row.key)) continue;
    const flag = longFlagOf(row.cli.flags);
    const raw = row.cli.parse ? row.cli.parse(opts[row.key]) : opts[row.key];
    Object.assign(cli, row.normalize(raw, flag));
  }
  // The deprecated alias lands on the same trackOut override key; both
  // spellings at once is ambiguous and rejected.
  if (givenOnCommandLine(program, TELEMETRY_JSON_ALIAS.inputKey)) {
    if (givenOnCommandLine(program, TELEMETRY_JSON_ALIAS.key)) {
      throw new Error(
        `${longFlagOf(TELEMETRY_JSON_ALIAS.flags)} and --track-out cannot be combined (use --track-out)`,
      );
    }
    onDeprecated(TELEMETRY_JSON_ALIAS.cliWarning);
    Object.assign(
      cli,
      OVERRIDE_NORMALIZERS.trackOut(
        opts[TELEMETRY_JSON_ALIAS.inputKey],
        longFlagOf(TELEMETRY_JSON_ALIAS.flags),
      ),
    );
  }
  const trackOutSpelling: TrackOutSpelling | null = givenOnCommandLine(
    program,
    TELEMETRY_JSON_ALIAS.inputKey,
  )
    ? 'telemetry-json'
    : givenOnCommandLine(program, TELEMETRY_JSON_ALIAS.key)
      ? 'track-out'
      : null;
  return { cli, trackOutSpelling };
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const program = buildProgram();
  program.exitOverride();
  program.parse(argv, { from: 'user' });
  const opts = program.opts<Record<string, unknown>>();
  const deprecationWarnings: string[] = [];
  const collected = collectOverrides(program, (message) =>
    deprecationWarnings.push(message),
  );

  return {
    inputs: [...program.args],
    cli: collected.cli,
    trackOutSpelling: collected.trackOutSpelling,
    configPath: typeof opts.config === 'string' ? opts.config : null,
    deprecationWarnings,
  };
}

function isCommanderExit(e: unknown): e is { code: string; exitCode: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e).code === 'string' &&
    (e as { code: string }).code.startsWith('commander.')
  );
}

function commanderExitCode(e: { code: string; exitCode: number }): number {
  return e.code === 'commander.helpDisplayed' || e.code === 'commander.version'
    ? 0
    : e.exitCode;
}

interface Invocation {
  inputs: string[];
  config: RenderConfig;
  configPath: string | null;
  deprecationWarnings: string[];
}

function resolveInvocation(argv: string[]): Invocation {
  const parsed = parseCliArgs(argv.slice(2));
  const deprecationWarnings = [...parsed.deprecationWarnings];
  const { config, configPath } = resolveConfig({
    cli: parsed.cli,
    configPath: parsed.configPath,
    cliTrackOutSpelling: parsed.trackOutSpelling,
    onDeprecated: (message) => deprecationWarnings.push(message),
  });
  return { inputs: parsed.inputs, config, configPath, deprecationWarnings };
}

function createLogger(config: RenderConfig): LogFn {
  return (msg: string): void => {
    if (!config.quiet) process.stderr.write(`[drone-path] ${msg}\n`);
  };
}

async function runPipeline(
  invocation: Invocation,
  log: LogFn,
): Promise<void> {
  const { inputs, config, configPath } = invocation;
  const tools = resolveFfmpegTools(config);
  await requireFfmpegTools(tools);
  const videos = collectRecordings(inputs, { recurse: config.recurse });
  if (config.outDir) fs.mkdirSync(config.outDir, { recursive: true });
  log(
    `${videos.length} recording(s) -> ${config.outDir ?? 'beside the sources'}` +
      (configPath ? ` (config: ${configPath})` : ''),
  );

  const emit = (summary: RecordingSummary): void => {
    if (config.json) {
      fs.writeSync(1, `${JSON.stringify(summary)}\n`);
    }
  };

  const result = await runBatch(videos, config, log, emit, {
    tools,
  });
  log(`done: ${result.ok} ok, ${result.skipped} skipped, ${result.failed} failed`);
  if (result.failed > 0) process.exitCode = 1;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    const invocation = resolveInvocation(argv);
    // Deprecation warnings are not progress output: they print even with --quiet.
    for (const warning of invocation.deprecationWarnings) {
      process.stderr.write(`[drone-path] ${warning}\n`);
    }
    const log = createLogger(invocation.config);
    await runPipeline(invocation, log);
  } catch (e) {
    if (isCommanderExit(e)) {
      process.exitCode = commanderExitCode(e);
      return;
    }
    process.stderr.write(
      `${ERROR_PREFIX}${errorMessage(e)}\n`,
    );
    process.exitCode = 1;
  }
}
