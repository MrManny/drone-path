import type { MapStyle } from '../config.js';

export interface TileSource {
  cacheKey: string;
  url: string;
  subdomains: string[];
  attribution: string;
  bg: string;
  placeholderBg: string;
  tileFilter: string | null;
  maxZoom: number;
  maxNativeZoom?: number;
}

export const TILE_SOURCES: Record<MapStyle, TileSource> = {
  // Esri World Imagery (free for non-commercial use, attribution required).
  satellite: {
    cacheKey: 'esri-imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subdomains: [''],
    attribution:
      'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    bg: '#0b0e14',
    placeholderBg: '#2a2f38',
    tileFilter: 'saturate(1.06) contrast(1.03)',
    maxZoom: 19,
  },
  topo: {
    cacheKey: 'opentopomap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    bg: '#eae5da',
    placeholderBg: '#eae5da',
    tileFilter: null,
    maxZoom: 19,
    maxNativeZoom: 17,
  },
};
