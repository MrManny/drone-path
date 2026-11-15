// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MapStyleTiles } from '../../ui/components/MapStyleTiles.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MapStyleTiles', () => {
  it('offers Satellite and Topographic as thumbnail tiles', () => {
    render(<MapStyleTiles value="satellite" onChange={() => true} />);
    const group = screen.getByRole('group', { name: 'Map style' });
    const tiles = [...group.querySelectorAll('button')];
    expect(tiles.map((t) => t.textContent)).toEqual(['Satellite', 'Topographic']);
    for (const tile of tiles) {
      const img = tile.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src') ?? '').not.toBe('');
      expect(img?.getAttribute('alt')).toBe('');
    }
  });

  it('marks the current style pressed and emits the picked one', () => {
    const onChange = vi.fn(() => true);
    render(<MapStyleTiles value="satellite" onChange={onChange} />);
    const tiles = screen
      .getAllByRole('button')
      .filter((b) => b.textContent === 'Satellite' || b.textContent === 'Topographic');
    expect(tiles[0].getAttribute('aria-pressed')).toBe('true');
    expect(tiles[1].getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(tiles[1]);
    expect(onChange).toHaveBeenCalledWith('topo');
  });

  it('keeps the tile credits with the thumbnails', () => {
    render(<MapStyleTiles value="topo" onChange={() => true} />);
    expect(screen.getByText(/Imagery © Esri, Maxar, Earthstar Geographics/)).toBeTruthy();
    expect(screen.getByText(/© OpenStreetMap contributors, SRTM/)).toBeTruthy();
  });
});
