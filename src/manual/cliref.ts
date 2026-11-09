import { CONFIG_FILE_OPTION, CONFIG_OPTIONS, cliDefaultOf } from '../config.js';
import type { ConfigOption, RenderConfig } from '../config.js';

function defaultCell(key: keyof RenderConfig): string {
  const value = cliDefaultOf(key);
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return value === '' ? '—' : `\`${value}\``;
}

function describe(row: ConfigOption): string {
  const help = row.cli.help.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return row.cli.choices ? `${help} (choices: ${row.cli.choices.join(', ')})` : help;
}

export function generateCliReference(): string {
  const rows = CONFIG_OPTIONS.map(
    (row) =>
      `| \`${row.key}\` | \`${row.cli.flags}\` | ${defaultCell(row.key)} | ${describe(row)} |`,
  );
  rows.push(`| — | \`${CONFIG_FILE_OPTION.flags}\` | — | ${CONFIG_FILE_OPTION.help} |`);
  return [
    '<!-- Generated from the option vocabulary in src/config.ts by "npm run docs:reference". Do not edit by hand. -->',
    '',
    '# CLI and config reference',
    '',
    'Every `drone-path` option with its config-file key and built-in default.',
    'In a [config file](config-file.md) every key is optional: anything omitted',
    'falls back to the default below. Run `npx drone-path --help` for the same',
    'table in the terminal.',
    '',
    '| Config key | CLI flag | Default | Description |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}
