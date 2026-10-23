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
import type {
  Config,
  ContinueWatchingEntry,
  LibraryItem,
  ServiceCatalog,
  ServiceTile,
} from '@openhearth/shared';
import { buildLibraryEntries, type LibraryEntry } from '../library/libraryModel';

export type HomeRow =
  | { kind: 'header'; itemCount: number }
  | { kind: 'services'; label: string; tiles: ServiceTile[]; itemCount: number }
  | {
      kind: 'library';
      label: string;
      source?: string;
      entries: LibraryEntry[];
      /**
       * Whether the row leads with a "See all" tile (col 0) that opens the full
       * library grid (#124). Present whenever the row has entries, so a large
       * collection is always one select away from the grid instead of a long
       * horizontal scroll.
       */
      seeAll: boolean;
      itemCount: number;
    }
  // Continue Watching (#155): in-progress items with a saved position.
  | { kind: 'continue'; label: string; entries: ContinueWatchingEntry[]; itemCount: number }
  // Next Up (#155): the next unwatched episode per in-progress series.
  | { kind: 'nextup'; label: string; entries: LibraryItem[]; itemCount: number };

export interface HomeModel {
  rows: HomeRow[];
}

const HEADER_ROW: HomeRow = { kind: 'header', itemCount: 3 }; // Search, Settings, Slideshow

/** Data for the resume/watch-derived rows (#155); absent → those rows are empty. */
export interface HomeDynamicRows {
  continueWatching?: ContinueWatchingEntry[];
  nextUp?: LibraryItem[];
}

export function buildHomeModel(
  config: Config,
  catalog?: ServiceCatalog,
  libraryBySource?: Map<string, LibraryItem[]>,
  dynamic?: HomeDynamicRows,
): HomeModel {
  const sourceLabels = new Map((config.library?.sources ?? []).map((s) => [s.id, s.label ?? s.id]));
  const tilesByGroup = new Map((catalog?.groups ?? []).map((g) => [g.group, g.services]));

  const contentRows: HomeRow[] = [];
  for (const row of config.ui?.rows ?? []) {
    if (row.type === 'services') {
      const label = row.group ?? 'Services';
      const tiles = (row.group ? tilesByGroup.get(row.group) : undefined) ?? [];
      contentRows.push({ kind: 'services', label, tiles, itemCount: tiles.length });
    } else if (row.type === 'continue_watching') {
      // Derived rows carry no header when empty — they simply vanish (cold cache,
      // nothing in progress) rather than showing an empty "Continue Watching".
      const entries = dynamic?.continueWatching ?? [];
      if (entries.length === 0) continue;
      const limited = row.limit ? entries.slice(0, row.limit) : entries;
      contentRows.push({
        kind: 'continue',
        label: row.title ?? 'Continue Watching',
        entries: limited,
        itemCount: limited.length,
      });
    } else if (row.type === 'next_up') {
      const entries = dynamic?.nextUp ?? [];
      if (entries.length === 0) continue;
      const limited = row.limit ? entries.slice(0, row.limit) : entries;
      contentRows.push({
        kind: 'nextup',
        label: row.title ?? 'Next Up',
        entries: limited,
        itemCount: limited.length,
      });
    } else {
      // type: library
      const label = row.source ? (sourceLabels.get(row.source) ?? row.source) : 'Library';
      const items = row.source ? (libraryBySource?.get(row.source) ?? []) : [];
      const entries = buildLibraryEntries(items);
      // The "See all" tile leads the row (col 0) whenever there's anything to
      // browse; an empty row has no grid to open, so it stays at zero focusables.
      const seeAll = entries.length > 0;
      contentRows.push({
        kind: 'library',
        label,
        ...(row.source ? { source: row.source } : {}),
        entries,
        seeAll,
        itemCount: entries.length + (seeAll ? 1 : 0),
      });
    }
  }

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
