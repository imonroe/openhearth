/**
 * Derive the home-screen layout from the validated config.
 *
 * Phase 1 renders the configured rows with placeholder (empty) tiles — the real
 * catalog and library content arrive with CatalogService (#23) and
 * LibraryService (#31). Row 0 is always the header (Search + Settings) so
 * Up from the top content row reaches it (design-system §9 navigation logic).
 */
import type { Config } from '@openhearth/shared';

/** Placeholder tiles per content row until real content lands. */
export const PLACEHOLDER_TILE_COUNT = 6;

export type HomeRowKind = 'header' | 'services' | 'library';

export interface HomeRow {
  kind: HomeRowKind;
  /** Row header label (uppercased by the view). Absent for the header row. */
  label?: string;
  /** Number of focusable items in the row. */
  itemCount: number;
}

export interface HomeModel {
  rows: HomeRow[];
}

const HEADER_ROW: HomeRow = { kind: 'header', itemCount: 2 }; // Search, Settings

export function buildHomeModel(config: Config): HomeModel {
  const sourceLabels = new Map((config.library?.sources ?? []).map((s) => [s.id, s.label ?? s.id]));

  const contentRows: HomeRow[] = (config.ui?.rows ?? []).map((row) => {
    if (row.type === 'services') {
      return {
        kind: 'services',
        label: row.group ?? 'Services',
        itemCount: PLACEHOLDER_TILE_COUNT,
      };
    }
    const label = row.source ? (sourceLabels.get(row.source) ?? row.source) : 'Library';
    return { kind: 'library', label, itemCount: PLACEHOLDER_TILE_COUNT };
  });

  return { rows: [HEADER_ROW, ...contentRows] };
}

/** Focusable-item counts per row, for the focus engine. */
export function rowLengths(model: HomeModel): number[] {
  return model.rows.map((r) => r.itemCount);
}
