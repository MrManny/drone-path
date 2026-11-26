'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, LocateFixed, Minus, Plus } from 'lucide-react';

import type { Bbox, LatLon } from 'drone-path-core/geo';
import type { MapStyle } from 'drone-path-engine/config';
import { TILE_BASE } from '../../shared/appurls.js';
import { leafName } from '../../shared/errors.js';
import type { ArchiveFlightDto, ArchiveNearHit } from '../../shared/ipc.js';
import {
  ARCHIVE_CLUSTER_MAX_ZOOM,
  clusterArchiveClips,
  computeItemsBounds,
  extractClipSpatialItems,
} from '../lib/archivecluster.js';
import type { ArchiveMapClipItem, ArchiveMapCluster } from '../lib/archivecluster.js';
import { formatArchiveDistance } from '../lib/archivedistance.js';
import { formatTime } from '../lib/frametime.js';
import { useTranslation } from '../lib/i18n.js';
import type { ArchiveMapView } from '../hooks/useArchiveWorkspace.js';
import { ArchivePointPopover } from './ArchivePointPopover.js';
import { BusyStatus } from './BusyStatus.js';

const SELECTED_COLOR = '#e87f54';
const HOVER_COLOR = '#f0a967';
const CLUSTER_BORDER = '#232323';
const FLIGHT_PALETTE = [
  '#3b82f6',
  '#14b8a6',
  '#a855f7',
  '#eab308',
  '#ec4899',
  '#22c55e',
  '#06b6d4',
  '#8b5cf6',
] as const;

const VIEWPORT_DEBOUNCE_MS = 180;
const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;

export interface ArchiveMapProps {
  flights: readonly ArchiveFlightDto[];
  style: MapStyle;
  selectedClipPath: string | null;
  onSelectClip: (clipPath: string) => void;
  onOpenClip?: (clipPath: string, seekSec?: number) => void;
  onViewportChange: (bbox: Bbox | null) => void;
  initialMapView?: ArchiveMapView | null;
  onMapViewChange?: (view: ArchiveMapView) => void;
  onStyleChange?: (style: MapStyle) => void;
  pointQueryActive?: boolean;
  onTogglePointQuery?: () => void;
  pointQueryCoord?: LatLon | null;
  pointHits?: readonly ArchiveNearHit[] | null;
  pointQueryLoading?: boolean;
  onPointQuery?: (point: LatLon, radiusM: number) => void;
  onClearPointQuery?: () => void;
}

function queryRadiusForZoom(zoom: number): number {
  return Math.round(Math.min(500, Math.max(50, 100 * Math.pow(2, 14 - zoom))));
}

function tileUrlFor(style: MapStyle): string {
  return `${TILE_BASE}/${style}/{z}/{x}/{y}.png`;
}

function tileOptionsFor(style: MapStyle): Leaflet.TileLayerOptions {
  return style === 'topo' ? { maxZoom: 19, maxNativeZoom: 17 } : { maxZoom: 19 };
}

function wrapLon(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

function boundsToBbox(bounds: Leaflet.LatLngBounds): Bbox {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const span = ne.lng - sw.lng;
  return {
    minLat: clampLat(sw.lat),
    maxLat: clampLat(ne.lat),
    minLon: span >= 360 ? -180 : wrapLon(sw.lng),
    maxLon: span >= 360 ? 180 : wrapLon(ne.lng),
  };
}

function toLeafletBounds(L: typeof Leaflet, bbox: Bbox): Leaflet.LatLngBounds {
  const east = bbox.minLon > bbox.maxLon ? bbox.maxLon + 360 : bbox.maxLon;
  return L.latLngBounds([bbox.minLat, bbox.minLon], [bbox.maxLat, east]);
}

function flightColor(flightIndex: number): string {
  return FLIGHT_PALETTE[flightIndex % FLIGHT_PALETTE.length];
}

function pathStyleFor(
  item: ArchiveMapClipItem,
  selectedClipPath: string | null,
  hoveredClipPath: string | null,
): Leaflet.PathOptions {
  const isSelected = item.clip.path === selectedClipPath;
  const isHovered = item.clip.path === hoveredClipPath;
  const offline = item.clip.availability === 'offline';

  if (isSelected) {
    return {
      color: SELECTED_COLOR,
      weight: 4,
      opacity: offline ? 0.75 : 1,
      dashArray: offline ? '6 4' : undefined,
    };
  }
  if (isHovered) {
    return {
      color: HOVER_COLOR,
      weight: 3.5,
      opacity: offline ? 0.75 : 0.95,
      dashArray: offline ? '6 4' : undefined,
    };
  }
  return {
    color: flightColor(item.flightIndex),
    weight: 2.5,
    opacity: offline ? 0.5 : 0.88,
    dashArray: offline ? '6 4' : undefined,
  };
}

export function ArchiveMap({
  flights,
  style,
  selectedClipPath,
  onSelectClip,
  onOpenClip,
  onViewportChange,
  initialMapView = null,
  onMapViewChange,
  onStyleChange,
  pointQueryActive = false,
  onTogglePointQuery,
  pointQueryCoord = null,
  pointHits = null,
  pointQueryLoading = false,
  onPointQuery,
  onClearPointQuery,
}: ArchiveMapProps) {
  const t = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const rendererRef = useRef<Leaflet.Canvas | null>(null);
  const tileLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const vectorGroupRef = useRef<Leaflet.LayerGroup | null>(null);
  const queryMarkerRef = useRef<Leaflet.CircleMarker | null>(null);
  const clipLayersRef = useRef<Map<string, { item: ArchiveMapClipItem; layers: Leaflet.Path[] }>>(
    new Map(),
  );

  const hasAutoFittedRef = useRef(false);
  const suppressViewportRef = useRef(false);
  const pendingFitAllRef = useRef(false);
  const fullBoundsRef = useRef<Bbox | null>(null);
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSelectClipRef = useRef(onSelectClip);
  const onViewportChangeRef = useRef(onViewportChange);
  const initialMapViewRef = useRef(initialMapView);
  const onMapViewChangeRef = useRef(onMapViewChange);
  const onPointQueryRef = useRef(onPointQuery);
  const pointQueryActiveRef = useRef(pointQueryActive);
  useEffect(() => {
    onSelectClipRef.current = onSelectClip;
    onViewportChangeRef.current = onViewportChange;
    initialMapViewRef.current = initialMapView;
    onMapViewChangeRef.current = onMapViewChange;
    onPointQueryRef.current = onPointQuery;
    pointQueryActiveRef.current = pointQueryActive;
  });

  const [mapReady, setMapReady] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [fullBounds, setFullBounds] = useState<Bbox | null>(null);
  const [hoveredClipPath, setHoveredClipPath] = useState<string | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<ArchiveMapCluster | null>(null);

  const spatialItems = useMemo(() => extractClipSpatialItems(flights), [flights]);
  const spatialBounds = useMemo(() => computeItemsBounds(spatialItems), [spatialItems]);

  useEffect(() => {
    if (spatialBounds && !fullBoundsRef.current) {
      fullBoundsRef.current = spatialBounds;
      setFullBounds(spatialBounds);
    } else if (spatialBounds && pendingFitAllRef.current) {
      fullBoundsRef.current = spatialBounds;
      setFullBounds(spatialBounds);
    }
  }, [spatialBounds]);

  const itemByPath = useMemo(() => {
    const byPath = new Map<string, ArchiveMapClipItem>();
    for (const item of spatialItems) byPath.set(item.clip.path, item);
    return byPath;
  }, [spatialItems]);

  const spatialItemsRef = useRef(spatialItems);
  useEffect(() => {
    spatialItemsRef.current = spatialItems;
  }, [spatialItems]);

  const selectedRef = useRef(selectedClipPath);
  const hoveredRef = useRef(hoveredClipPath);
  useEffect(() => {
    selectedRef.current = selectedClipPath;
    hoveredRef.current = hoveredClipPath;
  }, [selectedClipPath, hoveredClipPath]);

  const emitMapView = useCallback((map: Leaflet.Map) => {
    if (typeof map.getCenter !== 'function') return;
    const center = map.getCenter();
    onMapViewChangeRef.current?.({
      center: { lat: clampLat(center.lat), lon: wrapLon(center.lng) },
      zoom: map.getZoom(),
    });
  }, []);

  const scheduleViewportUpdate = useCallback((map: Leaflet.Map) => {
    if (suppressViewportRef.current) {
      suppressViewportRef.current = false;
      return;
    }
    if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    viewportTimerRef.current = setTimeout(() => {
      viewportTimerRef.current = null;
      onViewportChangeRef.current(boundsToBbox(map.getBounds()));
    }, VIEWPORT_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const clipLayers = clipLayersRef.current;

    const resizeObserver = new ResizeObserver(() => {
      mapRef.current?.invalidateSize();
    });
    resizeObserver.observe(host);

    void (async () => {
      const { default: L } = (await import('leaflet')) as unknown as {
        default: typeof Leaflet;
      };
      if (cancelled || typeof L?.map !== 'function') return;

      leafletRef.current = L;
      const renderer = L.canvas({ padding: 0.5 });
      rendererRef.current = renderer;

      const map = L.map(host, {
        preferCanvas: true,
        zoomControl: false,
        attributionControl: false,
        keyboard: true,
      });
      mapRef.current = map;

      vectorGroupRef.current = L.layerGroup().addTo(map);

      const initialBounds = computeItemsBounds(spatialItemsRef.current);
      if (initialBounds) {
        fullBoundsRef.current = initialBounds;
        setFullBounds(initialBounds);
      }

      const savedView = initialMapViewRef.current;
      if (savedView) {
        // Restoring a saved view marks auto-fit done so spatialBounds updates do not override it.
        hasAutoFittedRef.current = true;
        suppressViewportRef.current = true;
        map.setView([savedView.center.lat, savedView.center.lon], savedView.zoom);
        suppressViewportRef.current = false;
      } else if (initialBounds) {
        hasAutoFittedRef.current = true;
        suppressViewportRef.current = true;
        map.fitBounds(toLeafletBounds(L, initialBounds), { padding: [32, 32], maxZoom: 16 });
        suppressViewportRef.current = false;
      } else {
        suppressViewportRef.current = true;
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        suppressViewportRef.current = false;
      }

      setZoom(map.getZoom());

      const handleMoveOrZoom = () => {
        setZoom(map.getZoom());
        scheduleViewportUpdate(map);
        emitMapView(map);
      };

      map.on('zoomend', handleMoveOrZoom);
      map.on('moveend', handleMoveOrZoom);
      map.on('click', (event: Leaflet.LeafletMouseEvent) => {
        if (!pointQueryActiveRef.current || !onPointQueryRef.current) return;
        const latlng = event?.latlng;
        if (!latlng) return;
        onPointQueryRef.current(
          { lat: clampLat(latlng.lat), lon: wrapLon(latlng.lng) },
          queryRadiusForZoom(map.getZoom()),
        );
      });
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      if (viewportTimerRef.current) {
        clearTimeout(viewportTimerRef.current);
        viewportTimerRef.current = null;
      }
      queryMarkerRef.current?.remove();
      queryMarkerRef.current = null;
      clipLayers.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      rendererRef.current = null;
      tileLayerRef.current = null;
      vectorGroupRef.current = null;
    };
  }, [emitMapView, scheduleViewportUpdate]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;

    const layer = L.tileLayer(tileUrlFor(style), tileOptionsFor(style));
    const handleLoading = () => setTilesLoading(true);
    const handleLoad = () => setTilesLoading(false);
    if (typeof layer.on === 'function') {
      layer.on('loading', handleLoading);
      layer.on('load', handleLoad);
    }
    layer.addTo(map);
    tileLayerRef.current = layer;

    return () => {
      layer.off?.('loading', handleLoading);
      layer.off?.('load', handleLoad);
      layer.remove();
      tileLayerRef.current = null;
      setTilesLoading(false);
    };
  }, [mapReady, style]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map || !spatialBounds) return;

    if (!hasAutoFittedRef.current || pendingFitAllRef.current) {
      hasAutoFittedRef.current = true;
      pendingFitAllRef.current = false;
      suppressViewportRef.current = true;
      map.fitBounds(toLeafletBounds(L, spatialBounds), { padding: [32, 32], maxZoom: 16 });
      suppressViewportRef.current = false;
      setZoom(map.getZoom());
    }
  }, [mapReady, spatialBounds]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const renderer = rendererRef.current;
    const group = vectorGroupRef.current;
    if (!mapReady || !L || !map || !renderer || !group) return;

    group.clearLayers();
    clipLayersRef.current.clear();

    const { clusters, items } = clusterArchiveClips(spatialItems, zoom);

    for (const cluster of clusters) {
      const radius = Math.min(24, 12 + Math.log2(cluster.count) * 4);
      const marker = L.circleMarker([cluster.lat, cluster.lon], {
        renderer,
        radius,
        color: CLUSTER_BORDER,
        weight: 2,
        fillColor: SELECTED_COLOR,
        fillOpacity: 0.92,
      });
      if (typeof marker.bindTooltip === 'function') {
        marker.bindTooltip(String(cluster.count), {
          permanent: true,
          direction: 'center',
          interactive: false,
          className: 'archive-cluster-label',
        });
      }
      marker.on('mouseover', () => setHoveredCluster(cluster));
      marker.on('mouseout', () =>
        setHoveredCluster((prev) => (prev?.id === cluster.id ? null : prev)),
      );
      marker.on('click', (event) => {
        L.DomEvent?.stopPropagation?.(event);
        map.fitBounds(toLeafletBounds(L, cluster.bounds), {
          padding: [32, 32],
          maxZoom: ARCHIVE_CLUSTER_MAX_ZOOM + 3,
        });
      });
      marker.addTo(group);
    }

    const activeLayers: Leaflet.Path[] = [];
    for (const item of items) {
      const styleOptions = pathStyleFor(item, selectedRef.current, hoveredRef.current);
      const created: Leaflet.Path[] = [];

      const segments = item.track.filter((seg) => seg.length > 0);
      if (segments.length === 0) {
        const dot = L.circleMarker([item.lat, item.lon], {
          renderer,
          radius: 5,
          ...styleOptions,
          fillColor: styleOptions.color,
          fillOpacity: styleOptions.opacity,
        });
        created.push(dot);
      } else {
        for (const segment of segments) {
          const layer =
            segment.length === 1
              ? L.circleMarker([segment[0].lat, segment[0].lon], {
                  renderer,
                  radius: 5,
                  ...styleOptions,
                  fillColor: styleOptions.color,
                  fillOpacity: styleOptions.opacity,
                })
              : L.polyline(
                  segment.map((pt) => [pt.lat, pt.lon] as Leaflet.LatLngTuple),
                  {
                    renderer,
                    smoothFactor: 0,
                    ...styleOptions,
                  },
                );
          created.push(layer);
        }
      }

      for (const layer of created) {
        layer.on('mouseover', () => {
          setHoveredCluster(null);
          setHoveredClipPath(item.clip.path);
        });
        layer.on('mouseout', () => {
          setHoveredClipPath((prev) => (prev === item.clip.path ? null : prev));
        });
        layer.on('click', (event) => {
          L.DomEvent?.stopPropagation?.(event);
          onSelectClipRef.current(item.clip.path);
          if (onPointQueryRef.current) {
            const latlng = event?.latlng;
            const point: LatLon = latlng
              ? { lat: clampLat(latlng.lat), lon: wrapLon(latlng.lng) }
              : { lat: item.lat, lon: item.lon };
            onPointQueryRef.current(point, queryRadiusForZoom(map.getZoom()));
          }
        });
        layer.addTo(group);
        if (item.clip.path === selectedRef.current || item.clip.path === hoveredRef.current) {
          activeLayers.push(layer);
        }
      }

      clipLayersRef.current.set(item.clip.path, { item, layers: created });
    }

    for (const layer of activeLayers) {
      layer.bringToFront?.();
    }
  }, [mapReady, spatialItems, zoom]);

  useEffect(() => {
    const activeLayers: Leaflet.Path[] = [];
    for (const [clipPath, entry] of clipLayersRef.current.entries()) {
      const nextStyle = pathStyleFor(entry.item, selectedClipPath, hoveredClipPath);
      const isActive = clipPath === selectedClipPath || clipPath === hoveredClipPath;
      for (const layer of entry.layers) {
        layer.setStyle?.({
          ...nextStyle,
          fillColor: nextStyle.color,
          fillOpacity: nextStyle.opacity,
        });
        if (isActive) activeLayers.push(layer);
      }
    }
    for (const layer of activeLayers) {
      layer.bringToFront?.();
    }
  }, [selectedClipPath, hoveredClipPath]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    queryMarkerRef.current?.remove();
    queryMarkerRef.current = null;
    if (!mapReady || !L || !map || !pointQueryCoord) return;

    const marker = L.circleMarker([pointQueryCoord.lat, pointQueryCoord.lon], {
      renderer: rendererRef.current ?? undefined,
      radius: 8,
      color: '#e8e8e8',
      weight: 2,
      fillColor: SELECTED_COLOR,
      fillOpacity: 0.9,
      interactive: false,
    });
    marker.addTo(map);
    marker.bringToFront?.();
    queryMarkerRef.current = marker;
  }, [mapReady, pointQueryCoord]);

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut();
  }, []);

  const handleFitAll = useCallback(() => {
    if (viewportTimerRef.current) {
      clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = null;
    }
    pendingFitAllRef.current = true;
    onViewportChangeRef.current(null);

    const L = leafletRef.current;
    const map = mapRef.current;
    const target = fullBoundsRef.current ?? spatialBounds;
    if (L && map && target) {
      pendingFitAllRef.current = false;
      suppressViewportRef.current = true;
      map.fitBounds(toLeafletBounds(L, target), { padding: [32, 32], maxZoom: 16 });
      suppressViewportRef.current = false;
      setZoom(map.getZoom());
      emitMapView(map);
    }
  }, [emitMapView, spatialBounds]);

  const activeClipItem =
    (hoveredClipPath ? itemByPath.get(hoveredClipPath) : undefined) ??
    (selectedClipPath ? itemByPath.get(selectedClipPath) : undefined) ??
    null;

  const canFitAll = Boolean(fullBounds ?? spatialBounds);

  return (
    <div className="archive-map-container" role="region" aria-label={t('archiveMap.regionLabel')}>
      <div
        ref={hostRef}
        className={`archive-map-canvas style-${style}${pointQueryActive ? ' is-point-query' : ''}`}
        data-testid="archive-map-canvas"
      />

      <div className="archive-map-toolbar">
        {onStyleChange ? (
          <div
            className="segmented archive-map-style"
            role="group"
            aria-label={t('mapStyleTiles.mapStyle')}
          >
            <button
              type="button"
              className="segment"
              aria-pressed={style === 'satellite'}
              onClick={() => onStyleChange('satellite')}
            >
              {t('settings.satellite')}
            </button>
            <button
              type="button"
              className="segment"
              aria-pressed={style === 'topo'}
              onClick={() => onStyleChange('topo')}
            >
              {t('settings.topographic')}
            </button>
          </div>
        ) : null}

        <div className="archive-map-nav" role="group" aria-label={t('archiveMap.controls')}>
          {onTogglePointQuery ? (
            <button
              type="button"
              className="archive-map-btn archive-map-point-toggle"
              aria-pressed={Boolean(pointQueryActive)}
              title={t('archiveMap.whatFilmedHereHint')}
              onClick={onTogglePointQuery}
            >
              <Crosshair aria-hidden="true" />
              <span>{t('archiveMap.whatFilmedHere')}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="archive-map-btn"
            aria-label={t('archiveMap.fitAll')}
            title={t('archiveMap.fitAll')}
            disabled={!canFitAll}
            onClick={handleFitAll}
          >
            <LocateFixed aria-hidden="true" />
            <span>{t('archiveMap.fitAll')}</span>
          </button>
          <button
            type="button"
            className="archive-map-icon-btn"
            aria-label={t('zoomStepper.zoomIn')}
            title={t('zoomStepper.zoomIn')}
            onClick={handleZoomIn}
          >
            <Plus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="archive-map-icon-btn"
            aria-label={t('zoomStepper.zoomOut')}
            title={t('zoomStepper.zoomOut')}
            onClick={handleZoomOut}
          >
            <Minus aria-hidden="true" />
          </button>
        </div>
      </div>

      {!mapReady || tilesLoading ? <BusyStatus>{t('mapCard.preparingMap')}</BusyStatus> : null}

      {pointQueryCoord ? (
        <ArchivePointPopover
          coord={pointQueryCoord}
          hits={pointHits}
          loading={pointQueryLoading}
          onOpenClip={onOpenClip}
          onClose={() => onClearPointQuery?.()}
        />
      ) : null}

      {!pointQueryCoord && hoveredCluster ? (
        <div className="archive-map-readout" role="status" aria-live="polite">
          <span className="archive-map-readout-title">
            {t('archiveWorkspace.recordingCount', { count: hoveredCluster.count })}
          </span>
          <span className="hint">{t('archiveMap.clusterZoomHint')}</span>
        </div>
      ) : !pointQueryCoord && activeClipItem ? (
        <div className="archive-map-readout" role="status" aria-live="polite">
          <div className="archive-map-readout-info">
            <span className="archive-map-readout-title">
              {leafName(activeClipItem.clip.path)}
            </span>
            <span className="archive-map-readout-meta readout">
              {t('archiveWorkspace.flightHeading', { index: activeClipItem.flightIndex + 1 })}
              {' · '}
              {formatArchiveDistance(activeClipItem.clip.telemetry?.trackDistanceM, t)}
              {' · '}
              {activeClipItem.clip.video?.durationSec !== null &&
              activeClipItem.clip.video?.durationSec !== undefined
                ? formatTime(activeClipItem.clip.video.durationSec)
                : '--'}
            </span>
            {activeClipItem.clip.availability === 'offline' ? (
              <span className="archive-badge archive-badge-offline">
                {t('archiveWorkspace.offlineBadge')}
              </span>
            ) : null}
          </div>
          {onOpenClip &&
          selectedClipPath === activeClipItem.clip.path &&
          activeClipItem.clip.availability !== 'offline' ? (
            <button
              type="button"
              className="archive-map-open-btn"
              onClick={() => onOpenClip(activeClipItem.clip.path)}
            >
              {t('archiveMap.openSelected')}
            </button>
          ) : null}
        </div>
      ) : !pointQueryCoord && flights.length > 0 && spatialItems.length === 0 ? (
        <div className="archive-map-readout" role="status">
          <span className="hint">{t('archiveMap.noGpsInView')}</span>
        </div>
      ) : null}
    </div>
  );
}
