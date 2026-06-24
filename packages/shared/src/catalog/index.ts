/**
 * shared/catalog — the service-tile contract (Strategy A, the launcher).
 *
 * Users author service tiles as a few lines of YAML in `services.yaml` /
 * `services.d/*.yaml` (PRD §10.3). This is the validated model the server parses
 * them into and the web renders. Field names are snake_case to match the
 * authored YAML and PRD exactly. Zod is the single source of truth (see
 * ../README.md).
 *
 * Isomorphic: depends only on `zod`.
 */
import { z } from 'zod';

/** A single service tile definition. */
export const serviceSchema = z
  .object({
    /** Unique, stable identifier. */
    id: z.string().min(1),
    /** Display label on the tile. */
    name: z.string().min(1),
    /** Where the kiosk navigates on select (FR-A4: honored verbatim). */
    launch_url: z.string().url(),
    /** Local file in config/, a remote URL, or omitted (metadata fallback). */
    icon: z.string().optional(),
    /** Row/section grouping (matched by ui.rows[].group). */
    group: z.string().optional(),
    /** Sort hint within a group (ascending). */
    order: z.number().int().optional(),
    /** Optional UA override for kiosk compatibility (null = unset). */
    user_agent: z.string().nullable().optional(),
    /** Human notes; ignored by the app (null = unset). */
    notes: z.string().nullable().optional(),
  })
  .strict();

export type ServiceTile = z.infer<typeof serviceSchema>;

/** The shape of a `services.yaml` / `services.d/*.yaml` file. */
export const serviceFileSchema = z
  .object({
    services: z.array(z.unknown()).optional(),
  })
  .strict();

/** One group of tiles, in display order. */
export interface ServiceGroup {
  group: string;
  services: ServiceTile[];
}

/** The ordered, grouped catalog plus any non-fatal parse/validation errors. */
export interface ServiceCatalog {
  groups: ServiceGroup[];
  errors: string[];
}

/** Group label used for tiles that omit `group`. */
export const DEFAULT_SERVICE_GROUP = 'Ungrouped';

export const serviceJsonSchema = z.toJSONSchema(serviceSchema);
