/**
 * shared/config — the config contract.
 *
 * Zod is the single source of truth: the TypeScript `Config` type is inferred
 * from `configSchema`, and the runtime JSON Schema is generated from the same
 * schema (see ../README.md). The server validates host-mapped YAML against this;
 * the schema also documents the shape for users.
 *
 * Phase-0 stub: every field is optional so an empty config (`{}`) is valid —
 * OpenHearth must be fully usable with no provider configured (NFR-9). Later
 * phases add fields (catalog, library paths, keybindings, …) here.
 *
 * Isomorphic: depends only on `zod`.
 */
import { z } from 'zod';

export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export const logLevelSchema = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof logLevelSchema>;

/** Server runtime options. */
export const serverConfigSchema = z
  .object({
    /** TCP port the brain listens on. */
    port: z.number().int().min(1).max(65535).optional(),
    /** Structured-log verbosity. */
    logLevel: logLevelSchema.optional(),
  })
  .strict();

/** A single home-screen row (PRD §10.2). Tightened as the UI lands (#21/#23). */
export const uiRowSchema = z
  .object({
    /** What the row renders. */
    type: z.enum(['services', 'library']),
    /** Service grouping to show (for `type: services`). */
    group: z.string().optional(),
    /** Library source id to show (for `type: library`). */
    source: z.string().optional(),
  })
  .strict();

/** UI / home-screen options. */
export const uiConfigSchema = z
  .object({
    title: z.string().optional(),
    theme: z.enum(['dark', 'light']).optional(),
    /** Ordered layout of the home screen. */
    rows: z.array(uiRowSchema).optional(),
  })
  .strict();

/** A local-media library source (plain folder scan is the v1 default). */
export const librarySourceSchema = z
  .object({
    /** Stable id referenced by `ui.rows[].source`. */
    id: z.string(),
    label: z.string().optional(),
    /** Host-mapped path inside the container (e.g. `/media/movies`). */
    path: z.string(),
    kind: z.enum(['movies', 'tv', 'music', 'mixed']).optional(),
  })
  .strict();

export type LibrarySource = z.infer<typeof librarySourceSchema>;

/** Local-media library options. */
export const libraryConfigSchema = z
  .object({
    sources: z.array(librarySourceSchema).optional(),
    /** Optional, read-only Jellyfin/Plex reads (a Should, not a Must). Loose for now. */
    integrations: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .strict();

/** Metadata provider (TMDB) options. The key is interpolated from env in YAML. */
export const metadataConfigSchema = z
  .object({
    provider: z.enum(['tmdb']).optional(),
    /** TMDB API key (or `${TMDB_API_KEY}` interpolation). Optional by design. */
    tmdbApiKey: z.string().optional(),
    /** Preferred metadata language (BCP-47), e.g. `en-US`. */
    language: z.string().optional(),
  })
  .strict();

/** Hardware-accelerated transcode backends (opt-in; CPU is the default path). */
export const HWACCEL_BACKENDS = ['none', 'vaapi', 'nvenc', 'qsv'] as const;

/** Local-media transcode options (Strategy C). GPU is opt-in and per-host (#37). */
export const transcodeConfigSchema = z
  .object({
    /** Hardware encoder to use; `none` (default) is the guaranteed CPU path. */
    hwaccel: z.enum(HWACCEL_BACKENDS).optional(),
    /** Render device for VAAPI/QSV (e.g. `/dev/dri/renderD128`). */
    device: z.string().optional(),
  })
  .strict();

export type TranscodeConfig = z.infer<typeof transcodeConfigSchema>;

/**
 * Keybindings: logical binding name → list of physical key names. Permissive for
 * now (a record of string arrays); #46 wires this end-to-end and may tighten the
 * binding-name set. `home` is reserved and always returns to the home screen.
 */
export const keybindingsSchema = z.record(z.string(), z.array(z.string()));

/**
 * Top-level config. Strict so unknown keys surface as validation errors rather
 * than being silently ignored — but every field is optional, so `{}` is valid.
 */
export const configSchema = z
  .object({
    server: serverConfigSchema.optional(),
    ui: uiConfigSchema.optional(),
    library: libraryConfigSchema.optional(),
    metadata: metadataConfigSchema.optional(),
    transcode: transcodeConfigSchema.optional(),
    keybindings: keybindingsSchema.optional(),
  })
  .strict();

export type Config = z.infer<typeof configSchema>;

export interface ValidationSuccess {
  ok: true;
  config: Config;
}
export interface ValidationFailure {
  ok: false;
  /** Human-readable, path-scoped issues suitable for a config-error banner. */
  errors: string[];
}
export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate an unknown value (e.g. parsed YAML) against the config schema.
 *
 * Never throws — returns a discriminated result so callers can fall back to
 * last-good config and surface errors as a non-fatal banner (NFR-4).
 */
export function validateConfig(input: unknown): ValidationResult {
  const result = configSchema.safeParse(input);
  if (result.success) {
    return { ok: true, config: result.data };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return { ok: false, errors };
}

/** Runtime JSON Schema for the config (for docs / external tooling). */
export const configJsonSchema = z.toJSONSchema(configSchema);

/**
 * Dot-paths of secret leaves that must never be returned over the API or
 * written to logs. Keep this in lockstep with the schema as secret fields are
 * added — it is the single registry of "what counts as a secret."
 */
export const SECRET_CONFIG_PATHS = ['metadata.tmdbApiKey'] as const;

/** Sentinel substituted for a redacted secret value. */
export const REDACTED = '***';

/**
 * Return a deep copy of `config` with every configured secret leaf replaced by
 * {@link REDACTED}. Unset secrets are left absent (not added). Use this for any
 * config snapshot that crosses the API boundary so secrets like the TMDB key
 * are never exposed (CLAUDE.md: secrets never leave the host).
 */
export function redactConfig(config: Config): Config {
  // structuredClone keeps this isomorphic and avoids mutating the source.
  const copy = structuredClone(config) as Record<string, unknown>;
  for (const path of SECRET_CONFIG_PATHS) {
    const segments = path.split('.');
    let node: Record<string, unknown> | undefined = copy;
    for (let i = 0; i < segments.length - 1 && node; i++) {
      const child: unknown = node[segments[i] as string];
      node = child && typeof child === 'object' ? (child as Record<string, unknown>) : undefined;
    }
    const leaf = segments[segments.length - 1] as string;
    if (node && leaf in node && node[leaf] !== undefined) {
      node[leaf] = REDACTED;
    }
  }
  return copy as Config;
}
