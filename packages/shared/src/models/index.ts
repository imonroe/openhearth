/**
 * shared/models — the normalized media model (Strategy B foundation; FR-B2).
 *
 * A single provider-agnostic shape for "a piece of media" that the UI renders and
 * a future Aggregator/unified-search will query, regardless of where the data
 * came from (a local library scan, a TMDB lookup, or — later — a JustWatch-style
 * availability source). Nothing here knows about any specific provider: external
 * identifiers live in a free-form `ids` map and artwork is just resolved URLs, so
 * adding a second metadata provider later requires no change to this model
 * (FR-B2 acceptance).
 *
 * Mapping helpers (`mediaItemFromLibraryItem`) live here for the shared inputs;
 * the server maps provider results (e.g. TMDB) into the same shape. Zod is the
 * single source of truth (see ../README.md).
 *
 * Scope (FR-B2 "where useful"): library items and metadata results map into this
 * model. Service tiles deliberately keep their own `catalog` model — they are
 * launchers, not media — so they are not projected here; their optional artwork
 * fallback is handled at the UI layer (#42, FR-A6).
 *
 * Isomorphic: depends only on `zod` and the shared library types.
 */
import { z } from 'zod';
import { type LibraryItem } from '../library/index.js';

/**
 * Provider-agnostic media kind. `series` is a whole show (the metadata level),
 * distinct from a single `episode` (the library level); `other` covers loose or
 * unrecognized items so every library row still maps cleanly.
 */
export const MEDIA_KINDS = ['movie', 'series', 'episode', 'other'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Resolved artwork URLs (absolute). All optional — art is best-effort. */
export const mediaArtworkSchema = z
  .object({
    poster_url: z.string().optional(),
    backdrop_url: z.string().optional(),
    thumb_url: z.string().optional(),
  })
  .strict();

export type MediaArtwork = z.infer<typeof mediaArtworkSchema>;

/**
 * A single offering of a title on some service. **Reserved** for a future
 * JustWatch-style availability provider (FR-B2: "reserve the `availability`
 * slot … no implementation now"). Defined so the contract is stable, but nothing
 * populates it in v1.
 */
export const availabilityEntrySchema = z
  .object({
    /** Service id/name (e.g. `netflix`). */
    service: z.string(),
    /** How the title is offered. */
    offer: z.enum(['stream', 'rent', 'buy', 'free']).optional(),
    /** Deep link to the title on that service, when known. */
    url: z.string().optional(),
    /** Region this offer applies to (ISO 3166-1 alpha-2), when known. */
    region: z.string().optional(),
  })
  .strict();

export type AvailabilityEntry = z.infer<typeof availabilityEntrySchema>;

/**
 * A cast member on a title. `profile_url` is reserved for a future cast-image
 * proxy (like the poster cache) and is unset in v1 — the UI renders names only.
 */
export const castMemberSchema = z
  .object({
    name: z.string().min(1),
    /** The role they play, when known. */
    character: z.string().optional(),
    /** Provider-hosted headshot URL; reserved for a future image proxy. */
    profile_url: z.string().optional(),
  })
  .strict();

export type CastMember = z.infer<typeof castMemberSchema>;

/**
 * The normalized media item. `ids` is a free-form map of source → external id
 * (e.g. `{ tmdb: "603", imdb: "tt0133093" }`) so any provider can contribute
 * identifiers without a schema change. `id` is OpenHearth's own stable id for
 * the item (e.g. the library item id, or `<provider>:<kind>:<id>` for a pure
 * metadata result).
 *
 * The richer fields (`runtime_minutes`, `genres`, `cast`, `directors`,
 * `tagline`, `rating`) are populated by a full details lookup (#123) and are all
 * optional — a search-level result or a library item without enrichment is still
 * a valid item.
 */
export const mediaItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    year: z.number().int().nullable().optional(),
    kind: z.enum(MEDIA_KINDS),
    artwork: mediaArtworkSchema.optional(),
    /** Source → external id. Provider-agnostic and extensible. */
    ids: z.record(z.string(), z.string()).optional(),
    /** One-line synopsis when available. */
    overview: z.string().optional(),
    /** Runtime in whole minutes (movie runtime, or a TV episode's runtime). */
    runtime_minutes: z.number().int().positive().nullable().optional(),
    /** Genre names (e.g. `["Science Fiction", "Drama"]`). */
    genres: z.array(z.string()).optional(),
    /** Principal cast, best-first, capped by the provider. */
    cast: z.array(castMemberSchema).optional(),
    /** Director name(s) (creators for a series). */
    directors: z.array(z.string()).optional(),
    /** Marketing tagline, when present. */
    tagline: z.string().optional(),
    /** Average rating on a 0–10 scale, when available. */
    rating: z.number().min(0).max(10).nullable().optional(),
    /** Reserved for a future availability provider; unused in v1. */
    availability: z.array(availabilityEntrySchema).optional(),
  })
  .strict();

export type MediaItem = z.infer<typeof mediaItemSchema>;

export const mediaItemJsonSchema = z.toJSONSchema(mediaItemSchema);

/** Map a library item's `kind` onto the normalized media kind. */
function mediaKindFromLibrary(kind: LibraryItem['kind']): MediaKind {
  // `movie`/`episode` carry over; `other` (music, loose files) stays `other`.
  return kind === 'movie' ? 'movie' : kind === 'episode' ? 'episode' : 'other';
}

/**
 * Project a scanned {@link LibraryItem} into the normalized model. Carries the
 * filename-derived title/year through unchanged — metadata enrichment (artwork,
 * external ids) is layered on later (#42) and is not required for a valid item,
 * so the library is fully browsable with no provider configured (§13.2).
 */
export function mediaItemFromLibraryItem(item: LibraryItem): MediaItem {
  return {
    id: item.id,
    title: item.title,
    kind: mediaKindFromLibrary(item.kind),
    ...(item.year != null ? { year: item.year } : {}),
  };
}
