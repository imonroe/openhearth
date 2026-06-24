/**
 * shared/search — the search contract (Strategy B foundation; FR-B3).
 *
 * v1 ships **local-library search only**, but the response is shaped for the
 * future Aggregator: results are grouped into {@link SearchSection}s keyed by a
 * `source` string. A later release adds cross-service sources (TMDB discovery, a
 * JustWatch-style availability source, …) as *additional sections* — no breaking
 * change to this shape, and clients that only understand `library` ignore the
 * rest. There is intentionally **no** cross-service search in v1 (PRD §22/§23).
 *
 * Each section's items are the provider-agnostic {@link MediaItem}, so the same
 * tile/detail components render any source.
 *
 * Isomorphic: depends only on `zod` and the shared media model.
 */
import { z } from 'zod';
import { mediaItemSchema } from '../models/index.js';

/** Known search sources. Extend (don't replace) as cross-service search lands. */
export const SEARCH_SOURCES = ['library'] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

/** One group of results from a single source. */
export const searchSectionSchema = z
  .object({
    /** Result origin. `library` in v1; future sources slot in as new sections. */
    source: z.string(),
    /** Human label for the section header (e.g. "Your Library"). */
    label: z.string(),
    /** Matches, as normalized media items. */
    items: z.array(mediaItemSchema),
  })
  .strict();

export type SearchSection = z.infer<typeof searchSectionSchema>;

/** The `GET /api/v1/search` response. */
export const searchResponseSchema = z
  .object({
    /** The (trimmed) query that produced these results. */
    query: z.string(),
    /** Result sections, in display order. Empty when nothing matched. */
    sections: z.array(searchSectionSchema),
    /** Total items across all sections (convenience for the client). */
    total: z.number().int(),
  })
  .strict();

export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const searchResponseJsonSchema = z.toJSONSchema(searchResponseSchema);
