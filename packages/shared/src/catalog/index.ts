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

/** True for an http(s) URL or a safe relative filename (no scheme/abs/`..`). */
export function isSafeIcon(value: string): boolean {
  if (value.length === 0 || value.includes('\0')) return false;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false; // any other scheme (javascript:, data:, file:…)
  if (value.startsWith('/') || value.startsWith('\\')) return false; // absolute
  if (value.split(/[\\/]/).includes('..')) return false; // traversal
  return true;
}

/** A single service tile definition. */
export const serviceSchema = z
  .object({
    /** Unique, stable identifier. */
    id: z.string().min(1),
    /** Display label on the tile. */
    name: z.string().min(1),
    /**
     * Where the kiosk navigates on select (FR-A4: honored verbatim). Constrained
     * to http(s) at the validation seam: this is the literal navigation target,
     * and tiles can come from community `services.d/*` drop-ins, so a
     * `javascript:` / `data:` / `file:` URL would be a stored-injection or
     * local-file-exfil vector. Defense-in-depth — #25 also guards at nav time.
     */
    launch_url: z.string().refine(
      (u) => {
        try {
          return ['http:', 'https:'].includes(new URL(u).protocol);
        } catch {
          return false;
        }
      },
      { message: 'launch_url must be an http(s) URL' },
    ),
    /**
     * Local file in config/, a remote http(s) URL, or omitted (metadata
     * fallback). Constrained to an http(s) URL or a *safe relative filename* (no
     * scheme, not absolute, no `..` traversal) — `icon` is rendered as an
     * `<img src>` and resolved against config/, so an arbitrary scheme or path
     * would be an SSRF / file-disclosure vector.
     */
    icon: z
      .string()
      .refine(isSafeIcon, { message: 'icon must be an http(s) URL or a safe relative filename' })
      .optional(),
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

/**
 * The shape of a `services.yaml` / `services.d/*.yaml` file. NOT strict at the
 * file level: a stray top-level key (a stray `comment:`, `version:`, …) must not
 * nuke every tile in the file. Unknown keys are ignored; per-entry validation
 * (serviceSchema, strict) catches malformed tiles individually.
 */
export const serviceFileSchema = z.object({
  services: z.array(z.unknown()).optional(),
});

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
