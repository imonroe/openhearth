import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigService } from './ConfigService.js';
import { buildCatalog } from './CatalogService.js';

// Contract test: the shipped config.example/ must always validate against the
// schema, so the docs and defaults can't drift from what the server accepts.
const here = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(here, '../../../../config.example');

describe('config.example contract', () => {
  it('exists at the repo root', () => {
    expect(fs.existsSync(path.join(exampleDir, 'openhearth.yaml'))).toBe(true);
  });

  it('loads with zero validation errors', async () => {
    const svc = new ConfigService({ configDir: exampleDir });
    const snap = await svc.load();
    expect(snap.errors).toEqual([]);
    // Sanity: the rich example actually populated the effective config.
    expect(snap.config.ui?.title).toBe('OpenHearth');
    expect(snap.config.server?.port).toBe(8080);
    expect(snap.config.keybindings?.home).toEqual(['Home']);
  });

  it('loads the raw service catalog (base + overlays)', async () => {
    const svc = new ConfigService({ configDir: exampleDir });
    const snap = await svc.load();
    expect(snap.services.base).toBeTruthy();
    expect(Object.keys(snap.services.overlays).length).toBeGreaterThanOrEqual(1);
  });

  it('seeds a community catalog that validates and renders >= 6 tiles (#29)', async () => {
    const svc = new ConfigService({ configDir: exampleDir });
    const snap = await svc.load();
    const catalog = buildCatalog(snap.services);

    // Every shipped service definition must parse cleanly — the seed can't drift
    // from the schema users will be validated against.
    expect(catalog.errors).toEqual([]);

    const tiles = catalog.groups.flatMap((g) => g.services);
    // Acceptance: at least 6 ready-to-use service definitions render as tiles.
    expect(tiles.length).toBeGreaterThanOrEqual(6);

    // ids are unique across the merged catalog.
    const ids = tiles.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Most entries carry a compatibility `notes` field flagging kiosk/DRM
    // caveats (PRD §18) — at least the streaming video tiles do.
    const withNotes = tiles.filter((t) => typeof t.notes === 'string' && t.notes.length > 0);
    expect(withNotes.length).toBeGreaterThanOrEqual(6);
  });

  it('is internally coherent: every ui library row references a defined source', async () => {
    const svc = new ConfigService({ configDir: exampleDir });
    const { config } = await svc.load();
    const sourceIds = new Set((config.library?.sources ?? []).map((s) => s.id));
    const libraryRows = (config.ui?.rows ?? []).filter((r) => r.type === 'library');
    for (const row of libraryRows) {
      expect(row.source, 'library row missing source').toBeTruthy();
      expect(sourceIds.has(row.source as string)).toBe(true);
    }
  });
});
