import { afterEach, expect, it, vi } from 'vitest';

import { requireFfmpegTools } from 'drone-path-core/ffmpeg';
import { resolveFfmpegTools } from 'drone-path-core/ffmpeg-tools';
import { extractKeyframes } from 'drone-path-core/keyframes';
import type { ExtractedKeyframe } from 'drone-path-core/keyframes';

import { main } from '../src/cli.js';

vi.mock('drone-path-core/ffmpeg', { spy: true });
vi.mock('drone-path-core/ffmpeg-tools', { spy: true });
vi.mock('drone-path-core/keyframes', { spy: true });

afterEach(() => vi.restoreAllMocks());

const sampleResult: ExtractedKeyframe[] = [
  {
    path: '/out/clip_f75_2500ms.jpg',
    tSec: 2.5,
    frame: 75,
    width: 640,
    height: 360,
    telemetry: {
      lat: 46.6,
      lon: 14.2,
      altRelM: 12.5,
      altAbsM: 312.5,
      speedMps: 4.2,
      headingDeg: 180,
      gimbalPitchDeg: -20,
      gimbalYawDeg: 0,
      iso: 100,
      shutterTime: 0.002,
    },
  },
];

it('routes extract-frame with --json and writes only the JSON array to stdout', async () => {
  const tools = { ffmpeg: '/custom/ffmpeg', ffprobe: '/custom/ffprobe' };
  vi.mocked(resolveFfmpegTools).mockReturnValue(tools);
  vi.mocked(requireFfmpegTools).mockResolvedValue();
  vi.mocked(extractKeyframes).mockResolvedValue(sampleResult);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  await main([
    'node', 'drone-path', 'extract-frame', 'clip.mp4',
    '--at', '2.5,f90', '--max-width', '640', '--out-dir', '/out',
    '--ffmpeg', '/custom/ffmpeg', '--ffprobe', '/custom/ffprobe', '--json',
  ]);

  expect(resolveFfmpegTools).toHaveBeenCalledWith({
    ffmpeg: '/custom/ffmpeg',
    ffprobe: '/custom/ffprobe',
  });
  expect(requireFfmpegTools).toHaveBeenCalledWith(tools, expect.any(AbortSignal));
  expect(extractKeyframes).toHaveBeenCalledWith('clip.mp4', expect.objectContaining({
    at: [
      { kind: 'time', tSec: 2.5 },
      { kind: 'frame', frame: 90 },
    ],
    maxWidth: 640,
    outDir: '/out',
    tools,
  }));
  expect(output.mock.calls).toEqual([[JSON.stringify(sampleResult) + '\n']]);
  expect(error).not.toHaveBeenCalled();
});

it('writes concise keyframe lines to stdout and summary to stderr in text mode', async () => {
  vi.mocked(resolveFfmpegTools).mockReturnValue({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
  vi.mocked(requireFfmpegTools).mockResolvedValue();
  vi.mocked(extractKeyframes).mockResolvedValue(sampleResult);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  await main(['node', 'drone-path', 'extract-frame', 'clip.mp4', '--at', '2.5']);

  expect(output.mock.calls).toEqual([
    ['/out/clip_f75_2500ms.jpg (frame 75, 2.500s, 640x360)\n'],
  ]);
  expect(error.mock.calls).toEqual([
    ['[drone-path] extracted 1 keyframe(s)\n'],
  ]);
});

it.each([
  [['clip.mp4'], "required option '--at <specs>'"],
  [['clip.mp4', '--at', '2.5', '--max-width', '0'], 'expected a positive integer for --max-width'],
  [['clip.mp4', '--at', '2.5', '--max-width', '12px'], 'expected a positive integer for --max-width'],
  [['clip.mp4', '--at', '-5'], 'keyframe timestamp must be non-negative'],
])('rejects invalid extract-frame arguments %j', async (args, message) => {
  const previous = process.exitCode;
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    await main(['node', 'drone-path', 'extract-frame', ...args]);
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls).toEqual([[expect.stringContaining(message)]]);
    expect(output).not.toHaveBeenCalled();
  } finally {
    process.exitCode = previous;
  }
});
