/**
 * shared/library — the local-media library item contract (Strategy C).
 *
 * `LibraryService` (server) scans host-mapped folders and produces these items;
 * the web library browse (face) consumes them over the API. Field names are
 * snake_case to match both the SQLite `library_items` columns (plan §9.2) and
 * the JSON wire shape used elsewhere in the protocol. Zod is the single source
 * of truth (see ../README.md).
 *
 * Probe-derived fields (duration, container, codecs) are optional: a plain
 * folder scan fills only the filesystem + naming-derived fields, and ffprobe
 * enrichment lands later (issue #34). The SQLite cache that stores these is
 * always derived and disposable — never the source of truth.
 *
 * Isomorphic: depends only on `zod`.
 */
import { z } from 'zod';

/**
 * What a scanned item is. `movie` and `episode` come from naming detection
 * (FR-C6); everything else (music, unrecognized video, loose files) is `other`.
 */
export const LIBRARY_ITEM_KINDS = ['movie', 'episode', 'other'] as const;
export type LibraryItemKind = (typeof LIBRARY_ITEM_KINDS)[number];

/** A single indexed library item (one media file). */
export const libraryItemSchema = z
  .object({
    /** Stable id — a hash of `source_id` + the source-relative path. */
    id: z.string().min(1),
    /** Which `library.sources[].id` this item was scanned from. */
    source_id: z.string().min(1),
    kind: z.enum(LIBRARY_ITEM_KINDS),
    /** Absolute path inside the container (e.g. `/media/movies/Heat (1995).mkv`). */
    path: z.string().min(1),
    /** Display title (movie title, or the show title for an episode). */
    title: z.string().min(1),
    /** Release year, when parseable from the name. */
    year: z.number().int().nullable().optional(),
    /** TV season number (episodes only). */
    season: z.number().int().nullable().optional(),
    /** TV episode number (episodes only). */
    episode: z.number().int().nullable().optional(),
    /** Per-episode title, when parseable. */
    episode_title: z.string().nullable().optional(),
    /** Probe-derived (issue #34); null until enriched. */
    duration_sec: z.number().int().nullable().optional(),
    container: z.string().nullable().optional(),
    video_codec: z.string().nullable().optional(),
    audio_codec: z.string().nullable().optional(),
    /** File mtime (epoch seconds) — drives incremental re-scan. */
    mtime: z.number().int(),
    /** When this row was (re)indexed (epoch seconds). */
    indexed_at: z.number().int(),
  })
  .strict();

export type LibraryItem = z.infer<typeof libraryItemSchema>;

export const libraryItemJsonSchema = z.toJSONSchema(libraryItemSchema);

/** A paginated page of library items (the `GET /api/v1/library` response). */
export const libraryListResponseSchema = z
  .object({
    items: z.array(libraryItemSchema),
    /** Total items matching the query (across all pages). */
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .strict();

export type LibraryListResponse = z.infer<typeof libraryListResponseSchema>;

/** Default and max page sizes for the library listing. */
export const LIBRARY_PAGE_DEFAULT = 100;
export const LIBRARY_PAGE_MAX = 500;

/** A saved playback position for resume (FR-C5). */
export const resumePositionSchema = z
  .object({
    /** Seconds into the item. */
    position_sec: z.number().int().nonnegative(),
    /** When it was saved (epoch seconds). */
    updated_at: z.number().int(),
  })
  .strict();

export type ResumePosition = z.infer<typeof resumePositionSchema>;

/** Body of `PUT /api/v1/library/:id/resume`. */
export const resumeUpdateSchema = z.object({ position_sec: z.number().nonnegative() }).strict();

export type ResumeUpdate = z.infer<typeof resumeUpdateSchema>;
