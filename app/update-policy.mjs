// Whether this install can ever self-update. Only packaged builds that carry
// electron-builder's update metadata talk to the feed: NSIS and AppImage
// builds ship app-update.yml, portable installs and dev runs never do.
export function shouldCheckForUpdates({ packaged, hasUpdateMetadata }) {
  return packaged && hasUpdateMetadata;
}
