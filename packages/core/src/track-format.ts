// The --track-out vocabulary: the file extension alone selects the track
// format, shared by the CLI writer and the desktop save request. The one
// values list is both the vocabulary and the extension set.

export const TRACK_FORMAT_VALUES = ['gpx', 'geojson', 'kml', 'kmz', 'json'] as const;
type TrackFormat = (typeof TRACK_FORMAT_VALUES)[number];

export function trackFormatOf(file: string): TrackFormat {
  const match = /\.([^.\\/]+)$/.exec(file);
  const ext = match ? match[1].toLowerCase() : '';
  const format = TRACK_FORMAT_VALUES.find((candidate) => candidate === ext);
  if (!format) {
    throw new Error(
      `unsupported track file extension: ${file} (use .gpx, .geojson, .kml, .kmz or .json)`,
    );
  }
  return format;
}
