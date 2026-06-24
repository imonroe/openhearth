/**
 * Derive the home-screen layout from the validated config and the service
 * catalog.
 *
 * Services rows are filled with real tiles from the catalog (grouped by
 * `ui.rows[].group`); library rows are filled with browse entries (movies +
 * aggregated shows) from the LibraryService index (#31/#32). Row 0 is always the
 * header (Search + Settings) so Up from the top content row reaches it
 * (design-system §9).
 */
import type { Config, LibraryItem, ServiceCatalog, ServiceTile } from '@openhearth/shared';
import { buildLibraryEntries, type LibraryEntry } from '../library/libraryModel';

export type HomeRow =
  | { kind: 'header'; itemCount: number }
  | { kind: 'services'; label: string; tiles: ServiceTile[]; itemCount: number }
  | {
      kind: 'library';
      label: string;
      source?: string;
      entries: LibraryEntry[];
      itemCount: number;
    };

export interface HomeModel {
  rows: HomeRow[];
}

const HEADER_ROW: HomeRow = { kind: 'header', itemCount: 2 }; // Search, Settings

export function buildHomeModel(
  config: Config,
  catalog?: ServiceCatalog,
  libraryBySource?: Map<string, LibraryItem[]>,
): HomeModel {
  const sourceLabels = new Map((config.library?.sources ?? []).map((s) => [s.id, s.label ?? s.id]));
  const tilesByGroup = new Map((catalog?.groups ?? []).map((g) => [g.group, g.services]));

  const contentRows: HomeRow[] = (config.ui?.rows ?? []).map((row): HomeRow => {
    if (row.type === 'services') {
      const label = row.group ?? 'Services';
      const tiles = (row.group ? tilesByGroup.get(row.group) : undefined) ?? [];
      return { kind: 'services', label, tiles, itemCount: tiles.length };
    }
    const label = row.source ? (sourceLabels.get(row.source) ?? row.source) : 'Library';
    const items = row.source ? (libraryBySource?.get(row.source) ?? []) : [];
    const entries = buildLibraryEntries(items);
    return {
      kind: 'library',
      label,
      ...(row.source ? { source: row.source } : {}),
      entries,
      itemCount: entries.length,
    };
  });

  return { rows: [HEADER_ROW, ...contentRows] };
}

/** Focusable-item counts per row, for the focus engine. */
export function rowLengths(model: HomeModel): number[] {
  return model.rows.map((r) => r.itemCount);
}

/** Index of the first content row (row >= 1) that has focusable items, or null. */
export function firstContentRow(model: HomeModel): number | null {
  for (let i = 1; i < model.rows.length; i++) {
    if (model.rows[i]!.itemCount > 0) return i;
  }
  return null;
}
