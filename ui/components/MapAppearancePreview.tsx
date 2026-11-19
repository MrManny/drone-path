'use client';

import { useTranslation } from '../lib/i18n.js';
import type { HudLayout } from '../../src/config.js';
import type { SceneData } from '../../src/renderer/scene.js';
import { useSceneIsland } from '../hooks/useSceneIsland.js';
import type { ChipReadouts, HudChipId } from '../lib/chipreadouts.js';
import { exampleStateLabel } from '../lib/exampleflight.js';
import { HudChips } from './HudChips.js';
import 'leaflet/dist/leaflet.css';

interface MapAppearancePreviewProps {
  data: SceneData;
  frame: number;
  /** Without a recording the preview draws the bundled example flight. */
  isExample: boolean;
  hud: HudLayout;
  readouts: ChipReadouts;
  altUnavailable: boolean;
  onToggleChip: (chip: HudChipId) => void;
}

/** The export frame as a live preview: the map renderer draws it, the chips
    over it double as the toggles for the on-frame readouts. */
export function MapAppearancePreview({
  data,
  frame,
  isExample,
  hud,
  readouts,
  altUnavailable,
  onToggleChip,
}: MapAppearancePreviewProps) {
  const t = useTranslation();
  const hostRef = useSceneIsland({ data, frame });
  return (
    <div>
      <div className="map-appearance-head">
        <span className="preview-title">
          {isExample ? exampleStateLabel(t) : t('mapAppearancePreview.recording')}
        </span>
        <span className="readout">{t('mapAppearancePreview.exportFrame')}</span>
      </div>
      <div
        className="map-appearance-frame"
        style={{ aspectRatio: `${data.width} / ${data.height}` }}
      >
        <div className="scene-host" style={{ isolation: 'isolate' }} ref={hostRef} />
        <div className="preview-chips">
          <HudChips
            abbreviated
            hud={hud}
            readouts={readouts}
            altUnavailable={altUnavailable}
            onToggle={onToggleChip}
          />
        </div>
      </div>
    </div>
  );
}
