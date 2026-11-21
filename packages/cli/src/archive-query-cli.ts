import { Option } from 'commander';
import type { Command } from 'commander';
import { archiveDbPath } from 'drone-path-archive/paths';
import { DEFAULT_RADIUS_M, listArchive, listArchiveFlights, nearArchive, parseDateBound } from 'drone-path-archive/query';
import type { ArchiveAvailability, ListFilters } from 'drone-path-archive/query';
import type { Bbox, LatLon } from 'drone-path-core/geo';

interface QueryOptions {
  archiveDb?: string;
  json?: boolean;
}

interface ListOptions extends QueryOptions {
  groupBy?: 'flight';
  inBbox?: Bbox;
  after?: number;
  before?: number;
  minDist?: number;
  status?: ArchiveAvailability;
}

function decimal(text: string): number {
  const value = text.trim();
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value) ? Number(value) : NaN;
}

function meters(text: string): number {
  const value = decimal(text);
  if (!Number.isFinite(value) || value < 0) throw new Error('expected a nonnegative distance in meters');
  return value;
}

function availability(text: string): ArchiveAvailability {
  if (text !== 'online' && text !== 'offline') throw new Error('expected online or offline status');
  return text;
}

function point(text: string): LatLon {
  const [lat, lon, extra] = text.split(',').map(decimal);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || extra !== undefined) {
    throw new Error('expected a latitude,longitude pair within ±90 and ±180 degrees');
  }
  return { lat, lon };
}

function bbox(text: string): Bbox {
  const parts = text.split(',');
  if (parts.length !== 4) throw new Error('expected a bounding box as south,west,north,east');
  const southWest = point(parts.slice(0, 2).join(','));
  const northEast = point(parts.slice(2).join(','));
  if (southWest.lat > northEast.lat) throw new Error('expected south latitude at or below north latitude');
  return { minLat: southWest.lat, minLon: southWest.lon, maxLat: northEast.lat, maxLon: northEast.lon };
}

function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function listOptions(options: ListOptions): ListFilters {
  const { inBbox, after, before, minDist, status } = options;
  if (after !== undefined && before !== undefined && after > before) {
    throw new Error('expected --after at or before --before');
  }
  return { bbox: inBbox, afterMs: after, beforeMs: before, minDistanceM: minDist, availability: status };
}

function commonOptions(command: Command): Command {
  return command
    .option('--archive-db <path>', 'override the per-user archive database path')
    .option('--json', 'write a JSON array to stdout')
    .exitOverride();
}

export function addArchiveQueries(program: Command): void {
  commonOptions(program.command('list'))
    .description('List indexed recordings.')
    .option('--in-bbox <s,w,n,e>', 'filter clips by a viewport bounding box', bbox)
    .option('--after <date>', 'earliest camera date or timestamp, inclusive', parseDateBound)
    .option('--before <date>', 'latest camera date or timestamp, exclusive', parseDateBound)
    .option('--min-dist <m>', 'minimum track distance in meters', meters)
    .option('--status <state>', 'filter by online or offline availability', availability)
    .addOption(new Option('--group-by <kind>', 'group matching clips into flights').choices(['flight']))
    .action((options: ListOptions) => {
      const db = archiveDbPath(options.archiveDb);
      const filters = listOptions(options);
      if (options.groupBy === 'flight') {
        const flights = listArchiveFlights(db, filters);
        if (options.json) writeJson(flights);
        else for (const { flightId, clips } of flights) {
          process.stdout.write(`Flight ${flightId}\n`);
          for (const clip of clips) {
            const continuation = clip.splitFromKey === null ? '' : ' (split continuation)';
            process.stdout.write(`  [${clip.availability}] ${clip.path}${continuation}\n`);
          }
        }
        return;
      }
      const clips = listArchive(db, filters);
      if (options.json) writeJson(clips);
      else for (const clip of clips) process.stdout.write(`[${clip.availability}] ${clip.path}\n`);
    });

  commonOptions(program.command('near'))
    .description('Find where indexed recordings pass near a location.')
    // Commander treats a negative coordinate pair as an option, but the
    // required argument parser still rejects anything besides a coordinate.
    .allowUnknownOption()
    .argument('<lat,lon>', 'query latitude and longitude', point)
    .option('--radius <m>', 'search radius in meters', meters, DEFAULT_RADIUS_M)
    .option('--include-gaze', 'also match points inside estimated camera ground footprints')
    .action((location: LatLon, options: QueryOptions & { radius: number; includeGaze?: boolean }) => {
      const hits = nearArchive(archiveDbPath(options.archiveDb), location, options.radius, options.includeGaze);
      if (options.json) writeJson(hits);
      else for (const hit of hits) {
        const label = hit.matchType === 'gaze' ? 'in camera view' : `${hit.distanceM.toFixed(1)} m`;
        process.stdout.write(`${label} at ${hit.tSec.toFixed(2)} s [${hit.clip.availability}] ${hit.clip.path}\n`);
      }
    });
}
