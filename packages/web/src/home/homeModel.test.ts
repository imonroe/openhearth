import { describe, it, expect } from 'vitest';
import type { Config, LibraryItem, ServiceCatalog } from '@openhearth/shared';
import { buildHomeModel, rowLengths, firstContentRow } from './homeModel';

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

function libItem(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: over.id ?? 'i',
    source_id: 'movies',
    kind: 'movie',
    path: '/m/x.mkv',
    title: 'X',
    mtime: 1,
    indexed_at: 1,
    ...over,
  };
}

const library = new Map<string, LibraryItem[]>([
  [
    'movies',
    [
      libItem({ id: 'm1', title: 'Alpha', year: 2001 }),
      libItem({ id: 'm2', title: 'Bravo', year: 2002 }),
      libItem({ id: 'm3', title: 'Charlie', year: 2003 }),
    ],
  ],
]);

describe('buildHomeModel', () => {
  it('places the header at row 0 and fills services rows from the catalog', () => {
    const model = buildHomeModel(config, catalog, library);
    expect(model.rows[0]!.kind).toBe('header');
    const services = model.rows[1]!;
    expect(services.kind).toBe('services');
    if (services.kind === 'services') {
      expect(services.label).toBe('Streaming');
      expect(services.tiles.map((t) => t.id)).toEqual(['a', 'b']);
      expect(services.itemCount).toBe(2);
    }
  });

  it('fills library rows with entries from the indexed source', () => {
    const lib = buildHomeModel(config, catalog, library).rows[2]!;
    expect(lib.kind).toBe('library');
    if (lib.kind === 'library') {
      expect(lib.label).toBe('Movies');
      expect(lib.source).toBe('movies');
      expect(lib.entries.map((e) => e.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
      // A leading "See all" tile (col 0) makes the count entries + 1 (#124).
      expect(lib.seeAll).toBe(true);
      expect(lib.itemCount).toBe(4);
    }
  });

  it('library row without entries has no See All tile', () => {
    const lib = buildHomeModel(config, catalog).rows[2]!;
    if (lib.kind === 'library') {
      expect(lib.seeAll).toBe(false);
      expect(lib.itemCount).toBe(0);
    }
  });

  it('library row is empty (itemCount 0) when the source has no indexed items', () => {
    const lib = buildHomeModel(config, catalog).rows[2]!;
    expect(lib.itemCount).toBe(0);
  });

  it('renders an empty services row when the group has no catalog tiles', () => {
    const model = buildHomeModel(config, { groups: [], errors: [] }, library);
    expect(model.rows[1]!.itemCount).toBe(0);
  });

  it('rowLengths includes the header count and the library See All tile', () => {
    // header(2), services(2), library(3 entries + 1 See All) (#124).
    expect(rowLengths(buildHomeModel(config, catalog, library))).toEqual([2, 2, 4]);
  });

  it('firstContentRow skips the header and empty rows', () => {
    expect(firstContentRow(buildHomeModel(config, catalog, library))).toBe(1);
    // When the services row is empty, focus enters on the library row (index 2).
    expect(firstContentRow(buildHomeModel(config, { groups: [], errors: [] }, library))).toBe(2);
  });
});
