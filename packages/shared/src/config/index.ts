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
/** Optional shared-token auth for the API/WS (#47; PRD §17). Off by default. */
export const authConfigSchema = z
  .object({
    /**
     * Shared bearer token. When set, API/WS access requires it (via the
     * `Authorization: Bearer` header, a `?token=` query param, or the protocol
     * `auth` field). Unset (default) = open on a trusted LAN. A secret — never
     * returned over the API or logged. Supports `${VAR}` interpolation in YAML.
     */
    token: z.string().optional(),
  })
  .strict();

export const serverConfigSchema = z
  .object({
    /** TCP port the brain listens on. */
    port: z.number().int().min(1).max(65535).optional(),
    /**
     * Bind address (#47). Default `0.0.0.0` (all interfaces, LAN-reachable). Set
     * to `127.0.0.1` to restrict to loopback. The `HOST` env var takes precedence.
     */
    host: z.string().optional(),
    /** Structured-log verbosity. */
    logLevel: logLevelSchema.optional(),
    /** Optional shared-token auth (off by default). */
    auth: authConfigSchema.optional(),
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

/**
 * Custom home-screen wallpaper (#118). The image is stored under the config
 * volume (set via the Settings upload, or hand-dropped and referenced here).
 */
export const wallpaperConfigSchema = z
  .object({
    /** Render the wallpaper behind the UI. Defaults to off. */
    enabled: z.boolean().optional(),
    /**
     * Image path relative to the config dir (e.g. `wallpaper/background.jpg`).
     * Written by the Settings upload; may also be hand-edited to point at any
     * image dropped into the config volume. `..` and absolute paths are rejected
     * by the server when serving the file.
     */
    image: z.string().optional(),
    /** Wallpaper opacity, 0 (invisible) – 1 (opaque). Defaults to 1. */
    opacity: z.number().min(0).max(1).optional(),
  })
  .strict();

export type WallpaperConfig = z.infer<typeof wallpaperConfigSchema>;

/**
 * Available screensavers (#126). One procedurally-generated saver to start
 * (`aurora`); the list is the extension point — new savers are added here and
 * picked up by the Settings selector and the web screensaver registry. The
 * value is a stable id, not a display label.
 */
export const SCREENSAVERS = ['aurora'] as const;
export type ScreensaverType = (typeof SCREENSAVERS)[number];

/** Default idle timeout (minutes) before the screensaver activates. */
export const SCREENSAVER_DEFAULT_TIMEOUT_MINUTES = 5;
/** Upper bound on the configurable idle timeout (minutes). */
export const SCREENSAVER_MAX_TIMEOUT_MINUTES = 240;

/**
 * Idle screensaver (#126). After `timeoutMinutes` with no interaction the kiosk
 * shows the selected saver full-screen; any interaction dismisses it. The saver
 * is procedurally generated and animates across the whole frame to avoid panel
 * burn-in. Off only while a video is actively playing (handled client-side).
 */
export const screensaverConfigSchema = z
  .object({
    /** Activate the screensaver on idle. Defaults to on. */
    enabled: z.boolean().optional(),
    /** Idle minutes before activation (1 – {@link SCREENSAVER_MAX_TIMEOUT_MINUTES}). */
    timeoutMinutes: z.number().int().min(1).max(SCREENSAVER_MAX_TIMEOUT_MINUTES).optional(),
    /** Which saver to show. Defaults to the first entry in {@link SCREENSAVERS}. */
    type: z.enum(SCREENSAVERS).optional(),
  })
  .strict();

export type ScreensaverConfig = z.infer<typeof screensaverConfigSchema>;

/**
 * Slideshow / digital photo frame (#164). Cycles through user photos on the TV.
 * Usable both as the idle screensaver (`useAsScreensaver`) and on demand from the
 * home screen. Images come from two sources, unioned: photos uploaded through the
 * Settings modal (stored under `config/slideshow/uploads/`) and host-mapped
 * folders declared in `sources`. See {@link docs/slideshow-plan.md}.
 */
export const SLIDESHOW_TRANSITIONS = ['cut', 'fade', 'crossfade', 'wipe'] as const;
export type SlideshowTransition = (typeof SLIDESHOW_TRANSITIONS)[number];

export const SLIDESHOW_ORDERS = ['sequential', 'shuffle'] as const;
export type SlideshowOrder = (typeof SLIDESHOW_ORDERS)[number];

/** Default transition between images. */
export const SLIDESHOW_DEFAULT_TRANSITION: SlideshowTransition = 'crossfade';
/** Default image order. */
export const SLIDESHOW_DEFAULT_ORDER: SlideshowOrder = 'sequential';
/** Default seconds each image is shown. */
export const SLIDESHOW_DEFAULT_INTERVAL_SECONDS = 8;
/** Lower bound on the per-image interval (seconds). */
export const SLIDESHOW_MIN_INTERVAL_SECONDS = 3;
/** Upper bound on the per-image interval (seconds). */
export const SLIDESHOW_MAX_INTERVAL_SECONDS = 3600;

/**
 * A host-mapped folder scanned for images (#164). Mirrors `library.sources[]`:
 * folders can't be picked from the sandboxed browser, so they're declared here
 * by the operator and only what's mounted is visible.
 */
export const slideshowSourceSchema = z
  .object({
    /** Stable id used to derive image ids; also referenced in the UI. */
    id: z.string(),
    label: z.string().optional(),
    /** Host-mapped path inside the container (e.g. `/photos`). Read-only. */
    path: z.string(),
    /** Descend into subfolders. Defaults to off (top-level only). */
    recursive: z.boolean().optional(),
  })
  .strict();
export type SlideshowSource = z.infer<typeof slideshowSourceSchema>;

export const slideshowConfigSchema = z
  .object({
    /** Show the slideshow as the idle screensaver instead of a procedural saver. */
    useAsScreensaver: z.boolean().optional(),
    /** Seconds each image is shown ({@link SLIDESHOW_MIN_INTERVAL_SECONDS}–{@link SLIDESHOW_MAX_INTERVAL_SECONDS}). */
    intervalSeconds: z
      .number()
      .int()
      .min(SLIDESHOW_MIN_INTERVAL_SECONDS)
      .max(SLIDESHOW_MAX_INTERVAL_SECONDS)
      .optional(),
    /** Transition played between images. Defaults to `crossfade`. */
    transition: z.enum(SLIDESHOW_TRANSITIONS).optional(),
    /** Sequential (folder/upload order) or shuffle. Defaults to sequential. */
    order: z.enum(SLIDESHOW_ORDERS).optional(),
    /** Host-mapped folders scanned for images (#164). */
    sources: z.array(slideshowSourceSchema).optional(),
  })
  .strict();
export type SlideshowConfig = z.infer<typeof slideshowConfigSchema>;

/** UI / home-screen options. */
export const uiConfigSchema = z
  .object({
    title: z.string().optional(),
    theme: z.enum(['dark', 'light']).optional(),
    /** Ordered layout of the home screen. */
    rows: z.array(uiRowSchema).optional(),
    /** Custom background wallpaper (#118). */
    wallpaper: wallpaperConfigSchema.optional(),
    /** Idle screensaver (#126). */
    screensaver: screensaverConfigSchema.optional(),
    /** Slideshow / digital photo frame (#164). */
    slideshow: slideshowConfigSchema.optional(),
  })
  .strict();

export type UiConfig = z.infer<typeof uiConfigSchema>;

/**
 * Body for `PUT /api/v1/ui/settings` (#118): the UI-editable subset of `ui.*`
 * the Settings modal can persist. `wallpaper.image` is intentionally NOT here —
 * it's set only by the upload/delete endpoints, never as a free-form path.
 */
export const uiSettingsPatchSchema = z
  .object({
    theme: z.enum(['dark', 'light']).optional(),
    wallpaper: z
      .object({
        enabled: z.boolean().optional(),
        opacity: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    /** Screensaver settings the modal can persist (#126). */
    screensaver: screensaverConfigSchema.optional(),
    /**
     * Slideshow settings the modal can persist (#164). `sources[].path` is
     * intentionally NOT here — folders are declared in YAML, never as a
     * free-form path from the browser (same rule as `wallpaper.image`).
     */
    slideshow: z
      .object({
        useAsScreensaver: z.boolean().optional(),
        intervalSeconds: z
          .number()
          .int()
          .min(SLIDESHOW_MIN_INTERVAL_SECONDS)
          .max(SLIDESHOW_MAX_INTERVAL_SECONDS)
          .optional(),
        transition: z.enum(SLIDESHOW_TRANSITIONS).optional(),
        order: z.enum(SLIDESHOW_ORDERS).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type UiSettingsPatchBody = z.infer<typeof uiSettingsPatchSchema>;

/** Accepted wallpaper image content types → file extension (#118). */
export const WALLPAPER_CONTENT_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;

export type WallpaperContentType = keyof typeof WALLPAPER_CONTENT_TYPES;

/** Body for `POST /api/v1/ui/wallpaper` (#118): a base64-encoded image upload. */
export const wallpaperUploadSchema = z
  .object({
    content_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    /** Base64 (no data-URL prefix) of the raw image bytes. */
    data_base64: z.string().min(1),
  })
  .strict();

export type WallpaperUploadBody = z.infer<typeof wallpaperUploadSchema>;

/** Accepted slideshow image content types → file extension (#164). */
export const SLIDESHOW_IMAGE_CONTENT_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

export type SlideshowImageContentType = keyof typeof SLIDESHOW_IMAGE_CONTENT_TYPES;

/** Body for `POST /api/v1/slideshow/photos` (#164): a base64-encoded image upload. */
export const slideshowUploadSchema = z
  .object({
    content_type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    /** Base64 (no data-URL prefix) of the raw image bytes. */
    data_base64: z.string().min(1),
  })
  .strict();

export type SlideshowUploadBody = z.infer<typeof slideshowUploadSchema>;

/** One image in a resolved slideshow manifest — an opaque id, never a path. */
export interface SlideshowManifestImage {
  /** Opaque, stable id; the client requests `GET /api/v1/slideshow/image/:id`. */
  id: string;
  /** True when this image was uploaded (deletable) vs. folder-sourced (read-only). */
  uploaded: boolean;
}

/** Resolved slideshow manifest returned by `GET /api/v1/slideshow/manifest` (#164). */
export interface SlideshowManifest {
  images: SlideshowManifestImage[];
  settings: {
    intervalSeconds: number;
    transition: SlideshowTransition;
    order: SlideshowOrder;
  };
}

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

export type MetadataConfig = z.infer<typeof metadataConfigSchema>;

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
export const SECRET_CONFIG_PATHS = ['metadata.tmdbApiKey', 'server.auth.token'] as const;

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
