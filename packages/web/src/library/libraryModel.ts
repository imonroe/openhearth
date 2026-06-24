/**
 * Library browse model — turn a flat list of indexed {@link LibraryItem}s into
 * the entries the home rows and detail screens render.
 *
 * Movies and loose files surface as-is; episodes are grouped into a single
 * "show" entry per title, with their seasons enumerated, so a TV row shows one
 * tile per series (not one per episode). Sorting is stable and locale-pinned so
 * the grid order is deterministic across hosts.
 */
import type { LibraryItem } from '@openhearth/shared';

/** A TV series aggregated from its episodes. */
export interface ShowGroup {
  kind: 'show';
  /** Stable id for focus keys / selection. */
  id: string;
  title: string;
  year?: number;
  /** Episodes sorted by (season, episode). */
  episodes: LibraryItem[];
  /** Unique season numbers present, ascending. */
  seasons: number[];
  /** Poster URL (#42), taken from the first episode the server enriched. */
  artwork_url?: string;
}

/** A browsable entry: a single item (movie / other) or an aggregated show. */
export type LibraryEntry = LibraryItem | ShowGroup;

export function isShow(entry: LibraryEntry): entry is ShowGroup {
  return (entry as ShowGroup).kind === 'show';
}

/** Poster URL for an entry, or undefined when none was resolved (placeholder). */
export function entryArtworkUrl(entry: LibraryEntry): string | undefined {
  return entry.artwork_url ?? undefined;
}

/** Title used for display and ordering (works for both entry shapes). */
export function entryTitle(entry: LibraryEntry): string {
  return entry.title;
}

/** Stable id for an entry (used as a React key and selection target). */
export function entryId(entry: LibraryEntry): string {
  return entry.id;
}

/** Episodes belonging to a given season number, in episode order. */
export function episodesInSeason(show: ShowGroup, season: number): LibraryItem[] {
  return show.episodes.filter((e) => (e.season ?? 1) === season);
}

/** Group a source's items into browsable entries (movies + aggregated shows). */
export function buildLibraryEntries(items: readonly LibraryItem[]): LibraryEntry[] {
  const shows = new Map<string, ShowGroup>();
  const singles: LibraryItem[] = [];

  for (const item of items) {
    if (item.kind === 'episode') {
      let show = shows.get(item.title);
      if (!show) {
        show = {
          kind: 'show',
          id: `show:${item.title}`,
          title: item.title,
          ...(item.year != null ? { year: item.year } : {}),
          episodes: [],
          seasons: [],
        };
        shows.set(item.title, show);
      }
      show.episodes.push(item);
      // Earliest known year for the series.
      if (item.year != null && (show.year == null || item.year < show.year)) {
        show.year = item.year;
      }
      // First enriched episode supplies the series poster.
      if (show.artwork_url == null && item.artwork_url != null) {
        show.artwork_url = item.artwork_url;
      }
    } else {
      singles.push(item);
    }
  }

  for (const show of shows.values()) {
    show.episodes.sort(
      (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0),
    );
    show.seasons = [...new Set(show.episodes.map((e) => e.season ?? 1))].sort((a, b) => a - b);
  }

  const entries: LibraryEntry[] = [...singles, ...shows.values()];
  entries.sort((a, b) => entryTitle(a).localeCompare(entryTitle(b), 'en'));
  return entries;
}
