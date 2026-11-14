// The --track-out vocabulary: the file extension alone selects the track
// format, shared by the CLI writer and the desktop save request.

export const TRACK_FORMAT_VALUES = ['gpx', 'geojson', 'kml', 'kmz', 'json'] as const;
export type TrackFormat = (typeof TRACK_FORMAT_VALUES)[number];

const TRACK_EXTENSIONS: Readonly<Record<string, TrackFormat>> = Object.freeze({
  gpx: 'gpx',
  geojson: 'geojson',
  kml: 'kml',
  kmz: 'kmz',
  json: 'json',
});

export function trackFormatOf(file: string): TrackFormat {
  const match = /\.([^.\\/]+)$/.exec(file);
  const format = match ? TRACK_EXTENSIONS[match[1].toLowerCase()] : undefined;
  if (!format) {
    throw new Error(
      `unsupported track file extension: ${file} (use .gpx, .geojson, .kml, .kmz or .json)`,
    );
  }
  return format;
}
