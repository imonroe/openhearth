import { describe, it, expect } from 'vitest';
import { buildCatalog } from './CatalogService.js';
import type { RawServiceCatalog } from './ConfigService.js';

const raw = (base: unknown, overlays: Record<string, unknown> = {}): RawServiceCatalog => ({
  base,
  overlays,
});

const svc = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 'x',
  name: 'X',
  launch_url: 'https://example.com/',
  ...over,
});

describe('buildCatalog', () => {
  it('turns a few-line definition into a tile (FR-A1)', () => {
    const cat = buildCatalog(
      raw({
        services: [{ id: 'netflix', name: 'Netflix', launch_url: 'https://www.netflix.com/' }],
      }),
    );
    expect(cat.errors).toEqual([]);
    expect(cat.groups).toHaveLength(1);
    expect(cat.groups[0]!.group).toBe('Ungrouped');
    expect(cat.groups[0]!.services[0]).toMatchObject({
      id: 'netflix',
      launch_url: 'https://www.netflix.com/',
    });
  });

  it('groups by `group` and orders by `order` then name', () => {
    const cat = buildCatalog(
      raw({
        services: [
          svc({ id: 'b', name: 'Bravo', group: 'S', order: 20 }),
          svc({ id: 'a', name: 'Alpha', group: 'S', order: 10 }),
          svc({ id: 'z', name: 'Zeta', group: 'S' }), // no order -> last
          svc({ id: 'm', name: 'Mike', group: 'Music', order: 5 }),
        ],
      }),
    );
    const s = cat.groups.find((g) => g.group === 'S')!;
    expect(s.services.map((t) => t.id)).toEqual(['a', 'b', 'z']);
    // Group insertion order preserved: S before Music.
    expect(cat.groups.map((g) => g.group)).toEqual(['S', 'Music']);
  });

  it('merges services.d overlays on top of services.yaml', () => {
    const cat = buildCatalog(
      raw(
        {
          services: [
            svc({
              id: 'netflix',
              name: 'Netflix',
              group: 'Streaming',
              launch_url: 'https://www.netflix.com/',
            }),
          ],
        },
        {
          'disney.yaml': {
            services: [
              svc({
                id: 'disney',
                name: 'Disney+',
                group: 'Streaming',
                launch_url: 'https://www.disneyplus.com/',
              }),
            ],
          },
        },
      ),
    );
    expect(cat.errors).toEqual([]);
    const ids = cat.groups.flatMap((g) => g.services.map((s) => s.id));
    expect(ids).toContain('netflix');
    expect(ids).toContain('disney');
  });

  it('honors a per-service launch_url override from an overlay (FR-A4)', () => {
    const cat = buildCatalog(
      raw(
        { services: [svc({ id: 'netflix', name: 'Netflix', launch_url: 'https://old.example/' })] },
        {
          'override.yaml': {
            services: [
              svc({ id: 'netflix', name: 'Netflix', launch_url: 'https://www.netflix.com/' }),
            ],
          },
        },
      ),
    );
    const all = cat.groups.flatMap((g) => g.services);
    expect(all).toHaveLength(1); // deduped by id
    expect(all[0]!.launch_url).toBe('https://www.netflix.com/'); // overlay wins
  });

  it('reports a malformed entry without dropping the rest of the catalog', () => {
    const cat = buildCatalog(
      raw({
        services: [
          svc({ id: 'ok', name: 'OK', launch_url: 'https://ok.example/' }),
          { id: 'bad', name: 'Bad', launch_url: 'not-a-url' }, // invalid URL
          { name: 'NoId', launch_url: 'https://noid.example/' }, // missing id
        ],
      }),
    );
    const ids = cat.groups.flatMap((g) => g.services.map((s) => s.id));
    expect(ids).toEqual(['ok']); // the two bad entries are skipped
    expect(cat.errors.length).toBe(2);
    expect(cat.errors.some((e) => e.includes('launch_url'))).toBe(true);
    expect(cat.errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('rejects unknown fields on a service entry (strict)', () => {
    const cat = buildCatalog(raw({ services: [svc({ id: 'x', name: 'X', bogus: true })] }));
    expect(cat.groups.flatMap((g) => g.services)).toHaveLength(0);
    expect(cat.errors.length).toBe(1);
  });

  it('is empty (no error) when there are no services', () => {
    expect(buildCatalog(raw(undefined))).toEqual({ groups: [], errors: [] });
  });
});
