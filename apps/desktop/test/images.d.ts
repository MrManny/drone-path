// Static image imports in UI components (e.g. the map style thumbnails)
// resolve to URLs at build time; vitest resolves them the same way CSS
// side-effect imports are stubbed, so the honest contract is a URL string.
declare module '*.jpg' {
  const src: string;
  export default src;
}
