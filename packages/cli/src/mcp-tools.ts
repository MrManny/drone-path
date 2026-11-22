import fs from 'node:fs';
import path from 'node:path';

import type { McpServer as SdkMcpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { exportArchiveMarkers } from 'drone-path-archive/export';
import { scanArchive } from 'drone-path-archive/indexed-scan';
import {
  DEFAULT_RADIUS_M,
  listArchive,
  listArchiveFlights,
  listArchiveSegments,
  nearArchive,
  parseDateBound,
} from 'drone-path-archive/query';
import type { ArchiveSegment, ListFilters } from 'drone-path-archive/query';
import { errorMessage } from 'drone-path-core/errors';
import { probeVideo } from 'drone-path-core/ffmpeg';
import type { FfmpegToolPaths } from 'drone-path-core/ffmpeg-tools';
import type { Fps } from 'drone-path-core/frametime';
import { extractKeyframes, parseKeyframeSpecs } from 'drone-path-core/keyframes';
import type { KeyframeRequest } from 'drone-path-core/keyframes';
import {
  markerFormatOf,
  serializeDaVinciResolveCsv,
  serializeFcpxmlMarkers,
} from 'drone-path-core/nle-markers';
import type { MarkerRange } from 'drone-path-core/nle-markers';
import { SHOT_TYPES, segmentFlightShots } from 'drone-path-core/shot-segmentation';
import { loadTelemetrySamples } from 'drone-path-core/telemetry';
import { computeTelemetry } from 'drone-path-core/telemetry-math';
import { telemetrySummary } from 'drone-path-core/telemetry-summary';
import type { TrackRecord } from 'drone-path-core/track';
import {
  CODEC_VALUES,
  ENCODER_PRESET_VALUES,
  MAP_STYLE_VALUES,
  QUALITY_VALUES,
  asTrailColor,
  parseHud,
} from 'drone-path-engine/config';
import type { ConfigOverrides } from 'drone-path-engine/config';
import { resolveConfig } from 'drone-path-engine/configfile';
import type { LogFn } from 'drone-path-engine/logging';
import { planOutputs } from 'drone-path-engine/pipeline';
import type { RecordingSummary, runBatch } from 'drone-path-engine/pipeline';
import { collectRecordings } from 'drone-path-engine/recordings';

import {
  assertNotArchiveDb,
  assertPathInAllowedRoots,
  canonicalizePath,
  isPathInAllowedRoots,
} from './mcp-paths.js';

export interface McpToolContext {
  archiveDb: string;
  allowedRoots: readonly string[];
  getTools: () => Promise<FfmpegToolPaths>;
  runBatch: typeof runBatch;
  log: LogFn;
}

const DEFAULT_MAX_SAMPLES = 100;
export const MAX_MCP_RENDER_VIDEOS = 10;

function isMcpOverwriteAllowed(): boolean {
  const envOverwrite = process.env.DRONE_PATH_MCP_ALLOW_OVERWRITE?.trim().toLowerCase();
  return envOverwrite === '1' || envOverwrite === 'true';
}

const BboxSchema = z
  .object({
    minLat: z.number().finite().min(-90).max(90),
    minLon: z.number().finite().min(-180).max(180),
    maxLat: z.number().finite().min(-90).max(90),
    maxLon: z.number().finite().min(-180).max(180),
  })
  .strict()
  .refine((b) => b.minLat <= b.maxLat, {
    message: 'bbox minLat must be at or below maxLat',
  });

const DateBoundSchema = z.union([z.string().min(1), z.number().finite()]);

const ArchiveFiltersSchema = z
  .object({
    bbox: BboxSchema.optional(),
    after: DateBoundSchema.optional(),
    before: DateBoundSchema.optional(),
    afterMs: z.number().finite().optional(),
    beforeMs: z.number().finite().optional(),
    minDistanceM: z.number().finite().min(0).optional(),
    availability: z.enum(['online', 'offline']).optional(),
    segmentType: z.enum(SHOT_TYPES).optional(),
    minSmoothness: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

type RawArchiveFilters = z.infer<typeof ArchiveFiltersSchema>;

function resolveDateBound(
  bound: string | number | undefined,
  ms: number | undefined,
  label: 'after' | 'before',
): number | undefined {
  if (bound !== undefined && ms !== undefined) {
    throw new Error(`specify either ${label} or ${label}Ms, not both`);
  }
  if (ms !== undefined) return ms;
  if (bound === undefined) return undefined;
  return typeof bound === 'string' ? parseDateBound(bound) : bound;
}

function toListFilters(raw: RawArchiveFilters): ListFilters {
  const afterMs = resolveDateBound(raw.after, raw.afterMs, 'after');
  const beforeMs = resolveDateBound(raw.before, raw.beforeMs, 'before');
  if (afterMs !== undefined && beforeMs !== undefined && afterMs > beforeMs) {
    throw new Error('expected after at or before before');
  }
  return {
    ...(raw.bbox !== undefined ? { bbox: raw.bbox } : {}),
    ...(afterMs !== undefined ? { afterMs } : {}),
    ...(beforeMs !== undefined ? { beforeMs } : {}),
    ...(raw.minDistanceM !== undefined ? { minDistanceM: raw.minDistanceM } : {}),
    ...(raw.availability !== undefined ? { availability: raw.availability } : {}),
    ...(raw.segmentType !== undefined ? { segmentType: raw.segmentType } : {}),
    ...(raw.minSmoothness !== undefined ? { minSmoothness: raw.minSmoothness } : {}),
  };
}

function sampleTrackRecords(records: readonly TrackRecord[], maxSamples: number) {
  if (records.length === 0) return [];
  const indices: number[] = [];
  if (maxSamples === 1) {
    indices.push(0);
  } else if (records.length <= maxSamples) {
    for (let i = 0; i < records.length; i++) indices.push(i);
  } else {
    const step = (records.length - 1) / (maxSamples - 1);
    for (let i = 0; i < maxSamples; i++) {
      indices.push(Math.round(i * step));
    }
  }
  return indices.map((idx) => {
    const r = records[idx];
    const altAbsM =
      r.altAbs ?? (typeof r.gpsAltMm === 'number' ? r.gpsAltMm / 1000 : null);
    return {
      tSec: r.tSec,
      lat: r.lat ?? null,
      lon: r.lng ?? null,
      altRelM: r.altRel ?? null,
      altAbsM,
      yawDeg: r.yawDeg ?? null,
      gimbalPitchDeg: r.gimbalPitchDeg ?? null,
      iso: r.iso ?? null,
      shutterTime: r.shutterTime ?? null,
    };
  });
}

function parseAtSpec(
  at: string | (string | number)[],
): KeyframeRequest[] {
  if (typeof at === 'string') return parseKeyframeSpecs(at);
  return at.flatMap((entry) =>
    typeof entry === 'number'
      ? [{ kind: 'time' as const, tSec: entry }]
      : parseKeyframeSpecs(entry),
  );
}

const FpsSchema = z.union([
  z.number().finite().positive(),
  z
    .object({
      num: z.number().int().positive(),
      den: z.number().int().positive(),
      value: z.number().finite().positive().optional(),
      str: z.string().min(1).optional(),
    })
    .strict(),
]);

type FpsInput = z.infer<typeof FpsSchema>;

function normalizeFps(input: FpsInput): Fps {
  if (typeof input === 'number') {
    if (Number.isInteger(input)) {
      return { num: input, den: 1, value: input, str: String(input) };
    }
    const den = 1000;
    const num = Math.round(input * den);
    return { num, den, value: input, str: `${num}/${den}` };
  }
  const value = input.value ?? input.num / input.den;
  const str = input.str ?? (input.den === 1 ? String(input.num) : `${input.num}/${input.den}`);
  return { num: input.num, den: input.den, value, str };
}

function archiveSegmentToMarkerRange(segment: ArchiveSegment): MarkerRange {
  const video = segment.clip.video;
  if (
    !video ||
    video.durationSec === null ||
    !Number.isFinite(video.durationSec) ||
    video.durationSec <= 0 ||
    !Number.isFinite(video.fps.value) ||
    video.fps.value <= 0
  ) {
    throw new Error(`clip ${segment.clip.path} is missing video timing metadata for marker export`);
  }
  const durationSec = video.durationSec;
  const startSec = Math.max(0, Math.min(durationSec, segment.startSec));
  const endSec = Math.max(startSec, Math.min(durationSec, segment.endSec));
  const clipName = segment.clip.path.split(/[\\/]/u).at(-1);
  return {
    clipPath: segment.clip.path,
    ...(clipName ? { clipName } : {}),
    fps: video.fps,
    durationSec,
    startSec,
    endSec,
    label: segment.type,
    note:
      `smoothness ${segment.smoothness.toFixed(3)}, ` +
      `speed ${segment.meanSpeedMps.toFixed(2)} m/s, ` +
      `yawRate ${segment.meanYawRateDegPerSec.toFixed(2)} deg/s`,
  };
}

function serializeMarkers(format: 'csv' | 'fcpxml', markers: readonly MarkerRange[]): string {
  return format === 'csv'
    ? serializeDaVinciResolveCsv(markers)
    : serializeFcpxmlMarkers(markers);
}

const ABSOLUTE_PATH_RX =
  /(^|[\s"'(=])(\\\\[^\s"')\],;<>|/\\\r\n]+(?:[\\/][^\s"')\],;<>|/\\\r\n]*)*(?: [^\s"')\],;<>|/\\\r\n]+(?:[\\/][^\s"')\],;<>|/\\\r\n]*)+)*|[A-Za-z]:[\\/][^\s"')\],;<>|/\\\r\n]*(?:[\\/][^\s"')\],;<>|/\\\r\n]*)*(?: [^\s"')\],;<>|/\\\r\n]+(?:[\\/][^\s"')\],;<>|/\\\r\n]*)+)*|\/[^\s"')\],;<>|/\\\r\n]+(?:[\\/][^\s"')\],;<>|/\\\r\n]*)*(?: [^\s"')\],;<>|/\\\r\n]+(?:[\\/][^\s"')\],;<>|/\\\r\n]*)+)*)/gu;

export function sanitizeMcpErrorMessage(raw: string): string {
  return raw.replace(ABSOLUTE_PATH_RX, '$1<path>');
}

function toolHandler<TArgs>(
  log: LogFn,
  handler: (args: TArgs) => Promise<Record<string, unknown>>,
) {
  return async (args: TArgs) => {
    try {
      const result = await handler(args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (err) {
      const sanitized = sanitizeMcpErrorMessage(errorMessage(err));
      log(`tool error: ${sanitized}`);
      return {
        content: [{ type: 'text' as const, text: sanitized }],
        isError: true,
      };
    }
  };
}

export function registerMcpTools(sdkServer: SdkMcpServer, ctx: McpToolContext): void {
  const wrap = <TArgs>(handler: (args: TArgs) => Promise<Record<string, unknown>>) =>
    toolHandler(ctx.log, handler);
  sdkServer.registerTool(
    'archive_scan',
    {
      description:
        'Scan one or more allowed folders for DJI MP4 recordings and index telemetry, tracks, footprints, and shot segments into the archive database.',
      inputSchema: z
        .object({
          dirs: z.array(z.string().min(1)).min(1),
          recurse: z.boolean().optional(),
          prune: z.boolean().optional(),
        })
        .strict(),
    },
    wrap(async (args) => {
      const dirs = args.dirs.map((dir) => assertPathInAllowedRoots(dir, ctx.allowedRoots));
      const records = await scanArchive(dirs, {
        db: ctx.archiveDb,
        recurse: args.recurse,
        prune: args.prune,
        getTools: ctx.getTools,
        onRecord: (record) =>
          ctx.log(`archive_scan ${record.status}: ${path.basename(record.path)}`),
      });
      return { db: ctx.archiveDb, count: records.length, records };
    }),
  );

  sdkServer.registerTool(
    'archive_list_clips',
    {
      description:
        'List indexed recordings matching optional spatial, date, distance, availability, or kinematic shot filters.',
      inputSchema: ArchiveFiltersSchema,
    },
    wrap(async (args) => {
      const clips = listArchive(ctx.archiveDb, toListFilters(args)).filter((clip) =>
        isPathInAllowedRoots(clip.path, ctx.allowedRoots),
      );
      return { count: clips.length, clips };
    }),
  );

  sdkServer.registerTool(
    'archive_list_flights',
    {
      description:
        'List indexed recordings grouped into inferred flights matching optional filters.',
      inputSchema: ArchiveFiltersSchema,
    },
    wrap(async (args) => {
      const flights = listArchiveFlights(ctx.archiveDb, toListFilters(args))
        .map((flight) => ({
          ...flight,
          clips: flight.clips.filter((clip) => isPathInAllowedRoots(clip.path, ctx.allowedRoots)),
        }))
        .filter((flight) => flight.clips.length > 0);
      return { count: flights.length, flights };
    }),
  );

  sdkServer.registerTool(
    'archive_find_at_point',
    {
      description:
        'Find indexed clips whose GPS track passes within a radius of a coordinate, optionally including estimated camera gaze footprints.',
      inputSchema: z
        .object({
          lat: z.number().finite().min(-90).max(90),
          lon: z.number().finite().min(-180).max(180),
          radiusM: z.number().finite().min(0).optional(),
          includeGaze: z.boolean().optional(),
        })
        .strict(),
    },
    wrap(async (args) => {
      const hits = nearArchive(
        ctx.archiveDb,
        { lat: args.lat, lon: args.lon },
        args.radiusM ?? DEFAULT_RADIUS_M,
        args.includeGaze ?? false,
      ).filter((hit) => isPathInAllowedRoots(hit.clip.path, ctx.allowedRoots));
      return { count: hits.length, hits };
    }),
  );

  sdkServer.registerTool(
    'archive_list_segments',
    {
      description:
        'List indexed kinematic shot segments ordered by smoothness score and matching optional filters.',
      inputSchema: ArchiveFiltersSchema,
    },
    wrap(async (args) => {
      const segments = listArchiveSegments(ctx.archiveDb, toListFilters(args)).filter((seg) =>
        isPathInAllowedRoots(seg.clip.path, ctx.allowedRoots),
      );
      return { count: segments.length, segments };
    }),
  );

  sdkServer.registerTool(
    'clip_get_telemetry',
    {
      description:
        'Probe a recording and extract its telemetry summary, kinematic shot segments, and a bounded track sample preview.',
      inputSchema: z
        .object({
          videoPath: z.string().min(1),
          includeSamples: z.boolean().optional(),
          maxSamples: z.number().int().min(1).max(2000).optional(),
        })
        .strict(),
    },
    wrap(async (args) => {
      const videoPath = assertPathInAllowedRoots(args.videoPath, ctx.allowedRoots);
      const tools = await ctx.getTools();
      const probe = await probeVideo(tools, videoPath);
      const loaded = await loadTelemetrySamples(tools, videoPath, probe.durationSec, probe.camMeta);
      const video = {
        fps: probe.fps,
        frames: probe.frames,
        durationSec: Number.isFinite(probe.durationSec) ? probe.durationSec : null,
        width: probe.width,
        height: probe.height,
        creationTime: probe.creationTime ?? null,
      };
      if (!loaded) {
        return {
          videoPath,
          status: 'no-telemetry' as const,
          video,
          telemetry: null,
          segments: [],
          totalTrackRecords: 0,
          samples: [],
        };
      }
      const segments = segmentFlightShots(loaded.trackValues);
      const fixCount = loaded.samples.filter((sample) => sample.fix !== null).length;
      let status: 'ok' | 'no-gps';
      let telemetry: Record<string, unknown>;
      if (fixCount >= 2) {
        const computed = computeTelemetry(loaded, {
          frames: probe.frames,
          fpsValue: probe.fps.value,
        });
        status = 'ok';
        telemetry = {
          ...telemetrySummary(computed),
          sampleCount: computed.sampleCount,
          bbox: computed.bbox,
        };
      } else {
        status = 'no-gps';
        telemetry = {
          source: loaded.source,
          method: loaded.method,
          headingMode: null,
          fixCount,
          noLock: loaded.noLock,
          trackDistanceM: 0,
          sampleCount: loaded.samples.length,
          bbox: null,
        };
      }
      const samples =
        args.includeSamples === false
          ? []
          : sampleTrackRecords(loaded.trackValues, args.maxSamples ?? DEFAULT_MAX_SAMPLES);
      return {
        videoPath,
        status,
        video,
        telemetry,
        segments,
        totalTrackRecords: loaded.trackValues.length,
        samples,
      };
    }),
  );

  sdkServer.registerTool(
    'clip_extract_keyframes',
    {
      description:
        'Extract targeted JPEG keyframes and nearest telemetry snapshots from a recording at specified timestamps or frame numbers.',
      inputSchema: z
        .object({
          videoPath: z.string().min(1),
          at: z.union([
            z.string().min(1),
            z.array(z.union([z.string().min(1), z.number().finite().min(0)])).min(1),
          ]),
          maxWidth: z.number().int().min(1).optional(),
          outDir: z.string().min(1).optional(),
        })
        .strict(),
    },
    wrap(async (args) => {
      const videoPath = assertPathInAllowedRoots(args.videoPath, ctx.allowedRoots);
      const outDir = assertPathInAllowedRoots(
        args.outDir ?? path.dirname(videoPath),
        ctx.allowedRoots,
      );
      assertNotArchiveDb(outDir, ctx.archiveDb);
      const requests = parseAtSpec(args.at);
      const tools = await ctx.getTools();
      const keyframes = await extractKeyframes(videoPath, {
        at: requests,
        maxWidth: args.maxWidth,
        outDir,
        tools,
      });
      return { videoPath, outDir, count: keyframes.length, keyframes };
    }),
  );

  const MarkerRangeInputSchema = z
    .object({
      clipPath: z.string().min(1),
      startSec: z.number().finite().min(0),
      endSec: z.number().finite().min(0),
      label: z.string().min(1),
      note: z.string().optional(),
      color: z.string().optional(),
      durationSec: z.number().finite().positive().optional(),
      fps: FpsSchema.optional(),
    })
    .strict();

  sdkServer.registerTool(
    'export_markers',
    {
      description:
        'Export shot markers as DaVinci Resolve CSV (.csv) or Final Cut Pro XML (.fcpxml) from explicit ranges or indexed archive segments.',
      inputSchema: z
        .object({
          outputPath: z.string().min(1),
          ranges: z.array(MarkerRangeInputSchema).optional(),
          filters: ArchiveFiltersSchema.optional(),
        })
        .strict(),
    },
    wrap(async (args) => {
      if (args.ranges !== undefined && args.filters !== undefined) {
        throw new Error('specify either ranges or filters, not both');
      }
      const outputPath = assertPathInAllowedRoots(args.outputPath, ctx.allowedRoots);
      assertNotArchiveDb(outputPath, ctx.archiveDb);
      const allowOverwrite = isMcpOverwriteAllowed();
      const assertCanWriteOutput = () => {
        if (fs.existsSync(outputPath) && !allowOverwrite) {
          throw new Error(
            'refusing to overwrite existing marker output file (set DRONE_PATH_MCP_ALLOW_OVERWRITE=1 to allow)',
          );
        }
      };
      const format = markerFormatOf(outputPath);

      if (args.ranges !== undefined) {
        const archiveMeta = new Map<string, { durationSec: number; fps: Fps }>();
        if (args.ranges.some((r) => r.durationSec === undefined || r.fps === undefined)) {
          if (fs.existsSync(ctx.archiveDb)) {
            for (const clip of listArchive(ctx.archiveDb)) {
              if (
                clip.video &&
                clip.video.durationSec !== null &&
                Number.isFinite(clip.video.durationSec) &&
                clip.video.durationSec > 0
              ) {
                archiveMeta.set(canonicalizePath(clip.path), {
                  durationSec: clip.video.durationSec,
                  fps: clip.video.fps,
                });
              }
            }
          }
        }

        const markers: MarkerRange[] = [];
        for (const range of args.ranges) {
          const clipPath = assertPathInAllowedRoots(range.clipPath, ctx.allowedRoots);
          let durationSec = range.durationSec;
          let fps = range.fps !== undefined ? normalizeFps(range.fps) : undefined;
          if (durationSec === undefined || fps === undefined) {
            let meta = archiveMeta.get(clipPath);
            if (!meta) {
              const tools = await ctx.getTools();
              const probe = await probeVideo(tools, clipPath);
              if (!Number.isFinite(probe.durationSec) || probe.durationSec <= 0) {
                throw new Error(`clip ${clipPath} is missing duration metadata for marker export`);
              }
              meta = { durationSec: probe.durationSec, fps: probe.fps };
              archiveMeta.set(clipPath, meta);
            }
            durationSec ??= meta.durationSec;
            fps ??= meta.fps;
          }
          markers.push({
            clipPath,
            fps,
            durationSec,
            startSec: range.startSec,
            endSec: range.endSec,
            label: range.label,
            ...(range.note !== undefined ? { note: range.note } : {}),
            ...(range.color !== undefined ? { color: range.color } : {}),
          });
        }
        const content = serializeMarkers(format, markers);
        assertCanWriteOutput();
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, content, 'utf8');
        return { outputPath, format, count: markers.length };
      }

      const filters = args.filters ? toListFilters(args.filters) : {};
      const allSegments = listArchiveSegments(ctx.archiveDb, filters);
      const allowedSegments = allSegments.filter((seg) =>
        isPathInAllowedRoots(seg.clip.path, ctx.allowedRoots),
      );
      assertCanWriteOutput();
      if (allowedSegments.length === allSegments.length) {
        exportArchiveMarkers(ctx.archiveDb, outputPath, { filters });
      } else {
        const markers = allowedSegments.map(archiveSegmentToMarkerRange);
        const content = serializeMarkers(format, markers);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, content, 'utf8');
      }
      return { outputPath, format, count: allowedSegments.length };
    }),
  );

  const HudInputSchema = z.union([
    z.string().min(1),
    z
      .object({
        heading: z.boolean(),
        alt: z.boolean(),
        speed: z.boolean(),
      })
      .strict(),
  ]);

  sdkServer.registerTool(
    'render_map_video',
    {
      description:
        'Render flight-path map overlay videos (and optional track export) for allowed recordings or folders.',
      inputSchema: z
        .object({
          inputs: z.array(z.string().min(1)).min(1).max(MAX_MCP_RENDER_VIDEOS),
          outDir: z.string().min(1).optional(),
          outSuffix: z.string().min(1).optional(),
          width: z.number().int().min(1).optional(),
          height: z.number().int().min(1).optional(),
          style: z.enum(MAP_STYLE_VALUES).optional(),
          view: z.enum(['follow', 'overview']).optional(),
          camera: z.enum(['follow', 'overview']).optional(),
          zoom: z.number().finite().min(0).optional(),
          zoomOut: z.number().finite().min(0).optional(),
          introSec: z.number().finite().min(0).optional(),
          outroSec: z.number().finite().min(0).optional(),
          trailColor: z.string().nullable().optional(),
          hud: HudInputSchema.optional(),
          codec: z.enum(CODEC_VALUES).optional(),
          quality: z.enum(QUALITY_VALUES).optional(),
          preset: z.enum(ENCODER_PRESET_VALUES).optional(),
          trackOut: z.string().min(1).optional(),
          skipExisting: z.boolean().optional(),
          recurse: z.boolean().optional(),
          frameStart: z.number().int().min(0).optional(),
          frameEnd: z.number().int().min(0).optional(),
        })
        .strict(),
    },
    wrap(async (args) => {
      if ((args.frameStart !== undefined) !== (args.frameEnd !== undefined)) {
        throw new Error('frameStart and frameEnd must be provided together');
      }
      if (
        args.frameStart !== undefined &&
        args.frameEnd !== undefined &&
        args.frameStart > args.frameEnd
      ) {
        throw new Error('frameStart must be at or before frameEnd');
      }
      if (args.view !== undefined && args.camera !== undefined && args.view !== args.camera) {
        throw new Error('view and camera cannot specify conflicting modes');
      }

      const inputs = args.inputs.map((item) => assertPathInAllowedRoots(item, ctx.allowedRoots));
      const outDir =
        args.outDir !== undefined
          ? assertPathInAllowedRoots(args.outDir, ctx.allowedRoots)
          : undefined;
      const trackOut =
        args.trackOut !== undefined
          ? assertPathInAllowedRoots(args.trackOut, ctx.allowedRoots)
          : undefined;
      if (trackOut !== undefined) {
        assertNotArchiveDb(trackOut, ctx.archiveDb);
      }

      const cli: ConfigOverrides = {
        quiet: true,
        json: false,
        ...(outDir !== undefined ? { outDir } : {}),
        ...(args.outSuffix !== undefined ? { outSuffix: args.outSuffix } : {}),
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(args.style !== undefined ? { style: args.style } : {}),
        ...(args.view ?? args.camera ? { view: args.view ?? args.camera } : {}),
        ...(args.zoom !== undefined ? { zoom: args.zoom } : {}),
        ...(args.zoomOut !== undefined ? { zoomOut: args.zoomOut } : {}),
        ...(args.introSec !== undefined ? { introSec: args.introSec } : {}),
        ...(args.outroSec !== undefined ? { outroSec: args.outroSec } : {}),
        ...(args.trailColor !== undefined
          ? { trailColor: asTrailColor(args.trailColor, 'trailColor') }
          : {}),
        ...(args.hud !== undefined
          ? { hud: typeof args.hud === 'string' ? parseHud(args.hud) : args.hud }
          : {}),
        ...(args.codec !== undefined ? { codec: args.codec } : {}),
        ...(args.quality !== undefined ? { quality: args.quality } : {}),
        ...(args.preset !== undefined ? { preset: args.preset } : {}),
        ...(trackOut !== undefined ? { trackOut } : {}),
        ...(args.skipExisting !== undefined ? { skipExisting: args.skipExisting } : {}),
        ...(args.recurse !== undefined ? { recurse: args.recurse } : {}),
      };

      const { config } = resolveConfig({
        cli,
        cwd: ctx.allowedRoots[0],
        onDeprecated: (msg) => ctx.log(sanitizeMcpErrorMessage(msg)),
      });
      if (config.outDir) {
        assertPathInAllowedRoots(config.outDir, ctx.allowedRoots);
        assertNotArchiveDb(config.outDir, ctx.archiveDb);
      }
      if (config.trackOut) {
        assertPathInAllowedRoots(config.trackOut, ctx.allowedRoots);
        assertNotArchiveDb(config.trackOut, ctx.archiveDb);
      }
      if (/[\\/\0]/u.test(config.outSuffix)) {
        throw new Error('outSuffix must not contain path separators');
      }

      const videos = collectRecordings(inputs, { recurse: config.recurse });
      if (videos.length > MAX_MCP_RENDER_VIDEOS) {
        throw new Error(
          `refusing to render more than ${MAX_MCP_RENDER_VIDEOS} recordings in a single MCP tool call (found ${videos.length})`,
        );
      }
      for (const video of videos) {
        assertPathInAllowedRoots(video, ctx.allowedRoots);
      }
      const allowOverwrite = isMcpOverwriteAllowed();
      if (config.trackOut && fs.existsSync(config.trackOut) && !allowOverwrite) {
        throw new Error(
          'refusing to overwrite existing track output file (set DRONE_PATH_MCP_ALLOW_OVERWRITE=1 to allow)',
        );
      }
      for (const plan of planOutputs(videos, config)) {
        assertPathInAllowedRoots(plan.out, ctx.allowedRoots);
        assertNotArchiveDb(plan.out, ctx.archiveDb);
        if (fs.existsSync(plan.out) && !allowOverwrite) {
          throw new Error(
            'refusing to overwrite existing render output file (set DRONE_PATH_MCP_ALLOW_OVERWRITE=1 to allow)',
          );
        }
      }

      const tools = await ctx.getTools();
      if (config.outDir) fs.mkdirSync(config.outDir, { recursive: true });

      const summaries: RecordingSummary[] = [];
      const range =
        args.frameStart !== undefined && args.frameEnd !== undefined
          ? { start: args.frameStart, end: args.frameEnd }
          : undefined;
      const batch = await ctx.runBatch(
        videos,
        config,
        (msg) => ctx.log(sanitizeMcpErrorMessage(msg)),
        (summary) => summaries.push(summary),
        { tools, range },
      );

      return {
        ...batch,
        outDir: config.outDir,
        summaries,
      };
    }),
  );
}
