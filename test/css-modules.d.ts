// CSS side-effect imports (e.g. leaflet) resolve to real files the test
// program cannot type; vitest stubs them at runtime, so a silent module is
// the honest contract here.
declare module '*.css';
