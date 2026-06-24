import { describe, it, expect } from 'vitest';
import type { Config, ServiceCatalog } from '@openhearth/shared';
import { buildHomeModel, rowLengths, firstContentRow, PLACEHOLDER_TILE_COUNT } from './homeModel';

const config: Config = {
  ui: {
    rows: [
      { type: 'services', group: 'Streaming' },
      { type: 'library', source: 'movies' },
    ],
  },
  library: { sources: [{ id: 'movies', label: 'Movies', path: '/m' }] },
};

const catalog: ServiceCatalog = {
  errors: [],
  groups: [
    {
      group: 'Streaming',
      services: [
        { id: 'a', name: 'A', launch_url: 'https://a/' },
        { id: 'b', name: 'B', launch_url: 'https://b/' },
      ],
    },
  ],
};

describe('buildHomeModel', () => {
  it('places the header at row 0 and fills services rows from the catalog', () => {
    const model = buildHomeModel(config, catalog);
    expect(model.rows[0]!.kind).toBe('header');
    const services = model.rows[1]!;
    expect(services.kind).toBe('services');
    if (services.kind === 'services') {
      expect(services.label).toBe('Streaming');
      expect(services.tiles.map((t) => t.id)).toEqual(['a', 'b']);
      expect(services.itemCount).toBe(2);
    }
  });

  it('uses the library source label and placeholder count for library rows', () => {
    const library = buildHomeModel(config, catalog).rows[2]!;
    expect(library.kind).toBe('library');
    if (library.kind === 'library') {
      expect(library.label).toBe('Movies');
      expect(library.itemCount).toBe(PLACEHOLDER_TILE_COUNT);
    }
  });

  it('renders an empty services row when the group has no catalog tiles', () => {
    const model = buildHomeModel(config, { groups: [], errors: [] });
    expect(model.rows[1]!.itemCount).toBe(0);
  });

  it('rowLengths includes the header count', () => {
    expect(rowLengths(buildHomeModel(config, catalog))).toEqual([2, 2, PLACEHOLDER_TILE_COUNT]);
  });

  it('firstContentRow skips the header and empty rows', () => {
    expect(firstContentRow(buildHomeModel(config, catalog))).toBe(1);
    // When the services row is empty, focus enters on the library row (index 2).
    expect(firstContentRow(buildHomeModel(config, { groups: [], errors: [] }))).toBe(2);
  });
});
