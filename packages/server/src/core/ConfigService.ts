/**
 * ConfigService — load, validate, and hot-reload user settings.
 *
 * All user settings live in host-mapped YAML under `/config` (the source of
 * truth). This service:
 *   - loads `openhearth.yaml` (+ `services.yaml` and `services.d/*.yaml`),
 *   - interpolates `${VAR}` references from the environment (for secrets),
 *   - validates `openhearth.yaml` against the shared config schema,
 *   - keeps the effective config queryable by the rest of the server,
 *   - watches `/config` with chokidar and hot-reloads on change,
 *   - on an invalid edit, keeps serving the **last-good** config and surfaces
 *     a non-fatal error (NFR-4) instead of crashing.
 *
 * The DB/cache is disposable; this YAML is authoritative. Any code path must
 * tolerate missing/empty config: a cold start with no `/config` yields the
 * empty (all-defaults) config, which is valid.
 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml, parseDocument, isMap } from 'yaml';
import chokidar, { type FSWatcher } from 'chokidar';
import { validateConfig, type Config } from '@openhearth/shared';

export interface ConfigServiceOptions {
  /** Directory holding the host-mapped YAML (defaults to `/config`). */
  configDir: string;
  /** Environment used for `${VAR}` interpolation (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Debounce window (ms) for coalescing rapid file events. */
  debounceMs?: number;
  /**
   * Watch by polling instead of native fs events. Native `inotify` events do
   * not propagate across Docker bind mounts when files are edited on the host,
   * so polling is the only reliable way to hot-reload `/config` in a container.
   * Defaults to `true`; set `false` on a host where native events work to avoid
   * the (small) polling cost.
   */
  usePolling?: boolean;
  /** Poll interval (ms) when `usePolling` is set. */
  pollInterval?: number;
}

/** Raw, not-yet-schema'd service catalog data (CatalogService owns parsing). */
export interface RawServiceCatalog {
  /** Contents of `services.yaml`, if present. */
  base: unknown;
  /** Contents of each `services.d/*.yaml`, keyed by filename. */
  overlays: Record<string, unknown>;
}

export interface ConfigSnapshot {
  config: Config;
  services: RawServiceCatalog;
  /** Non-fatal validation/parse errors from the most recent (re)load. */
  errors: string[];
}

/**
 * A patch the UI can persist back to `openhearth.yaml` (#118). Only the keys
 * present are written; everything else in the file (including comments and
 * `${VAR}` secrets) is preserved verbatim.
 */
export interface UiSettingsPatch {
  theme?: 'dark' | 'light';
  wallpaper?: {
    enabled?: boolean;
    /** Relative path under the config dir, or `null` to clear it. */
    image?: string | null;
    opacity?: number;
  };
}

const OPENHEARTH_FILE = 'openhearth.yaml';
const SERVICES_FILE = 'services.yaml';
const SERVICES_DIR = 'services.d';

/**
 * Replace `${VAR}` / `${VAR:-default}` in a single string with values from
 * `env`. An empty env value is treated as unset (so it falls through to the
 * default) — appropriate for optional secrets.
 */
export function interpolateEnv(input: string, env: NodeJS.ProcessEnv): string {
  return input.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g,
    (_m, name: string, def?: string) => {
      const value = env[name];
      if (value !== undefined && value !== '') return value;
      return def ?? '';
    },
  );
}

/**
 * Interpolate `${VAR}` references in every string *leaf* of an already-parsed
 * YAML tree. Interpolating after parsing (rather than on the raw text) means an
 * env value can never inject YAML structure — it only ever fills the scalar it
 * appears in, even if the value contains `:` or newlines.
 */
export function interpolateTree(node: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof node === 'string') return interpolateEnv(node, env);
  if (Array.isArray(node)) return node.map((item) => interpolateTree(item, env));
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = interpolateTree(value, env);
    }
    return out;
  }
  return node;
}

export class ConfigService extends EventEmitter {
  /** Directory holding the host-mapped YAML (and service icon files). */
  readonly configDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly debounceMs: number;
  private readonly usePolling: boolean;
  private readonly pollInterval: number;

  private current: ConfigSnapshot = {
    config: {},
    services: { base: undefined, overlays: {} },
    errors: [],
  };
  private watcher: FSWatcher | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private loadToken = 0;
  /** Serializes settings write-backs so concurrent saves don't interleave. */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(options: ConfigServiceOptions) {
    super();
    this.configDir = options.configDir;
    this.env = options.env ?? process.env;
    this.debounceMs = options.debounceMs ?? 150;
    this.usePolling = options.usePolling ?? true;
    this.pollInterval = options.pollInterval ?? 300;
  }

  /** The effective, validated config. Always present (empty config is valid). */
  get config(): Config {
    return this.current.config;
  }

  /** Raw service catalog data for CatalogService to parse. */
  get services(): RawServiceCatalog {
    return this.current.services;
  }

  /** Non-fatal errors from the most recent (re)load (empty when all-good). */
  get errors(): string[] {
    return this.current.errors;
  }

  /** Full current snapshot. */
  get snapshot(): ConfigSnapshot {
    return this.current;
  }

  /** Read + validate `/config` once. Never throws; falls back to last-good. */
  async load(): Promise<ConfigSnapshot> {
    // Generation token: if a newer load() starts while this one is awaiting the
    // filesystem, the newer one wins and this (now-stale) result is discarded.
    // Serializes overlapping reloads/loads so the latest read always wins.
    const token = ++this.loadToken;
    const next = await this.read();
    if (token !== this.loadToken) return this.current;

    if (next.fatal) {
      // Keep last-good config; only replace the reported errors.
      this.current = { ...this.current, errors: next.errors };
    } else {
      this.current = {
        config: next.config,
        services: next.services,
        errors: next.errors,
      };
    }
    return this.current;
  }

  /**
   * Persist a UI settings patch into `openhearth.yaml` (#118), preserving the
   * file's comments and unrelated content — only the touched `ui.*` keys change.
   * Writes are serialized and atomic (temp file + rename). Returns the reloaded
   * snapshot. Rejects if the file has YAML syntax errors or a non-mapping root,
   * rather than clobbering a file it can't safely round-trip.
   */
  async applyUiSettings(patch: UiSettingsPatch): Promise<ConfigSnapshot> {
    const run = this.writeQueue.then(() => this.writeUiSettings(patch));
    // Keep the chain alive for the next caller even if this write rejects.
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  private async writeUiSettings(patch: UiSettingsPatch): Promise<ConfigSnapshot> {
    const primaryPath = path.join(this.configDir, OPENHEARTH_FILE);
    const raw = fs.existsSync(primaryPath) ? await fsp.readFile(primaryPath, 'utf8') : '';

    // parseDocument keeps comments/structure for a round-trip. An empty file
    // yields a null-contents doc; the first setIn below builds the map.
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      throw new Error(`${OPENHEARTH_FILE} has YAML syntax errors; fix it before changing settings`);
    }
    if (doc.contents != null && !isMap(doc.contents)) {
      throw new Error(`${OPENHEARTH_FILE} root is not a mapping`);
    }

    if (patch.theme !== undefined) doc.setIn(['ui', 'theme'], patch.theme);
    if (patch.wallpaper) {
      const w = patch.wallpaper;
      if (w.enabled !== undefined) doc.setIn(['ui', 'wallpaper', 'enabled'], w.enabled);
      if (w.opacity !== undefined) doc.setIn(['ui', 'wallpaper', 'opacity'], w.opacity);
      if (w.image !== undefined) {
        if (w.image === null) doc.deleteIn(['ui', 'wallpaper', 'image']);
        else doc.setIn(['ui', 'wallpaper', 'image'], w.image);
      }
    }

    // Atomic replace so a reader (or the watcher) never sees a half-written file.
    // The `.tmp` suffix is ignored by the watcher above.
    const tmp = `${primaryPath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, doc.toString(), 'utf8');
    await fsp.rename(tmp, primaryPath);

    // Reload now so the returned snapshot reflects the write immediately; the
    // watcher will also fire, but reloads are idempotent (latest read wins).
    return this.load();
  }

  /** Load once, then watch `/config` for changes and hot-reload. */
  async start(): Promise<ConfigSnapshot> {
    const snapshot = await this.load();
    const watcher = chokidar.watch(this.configDir, {
      ignoreInitial: true,
      // Don't react to our own atomic-write temp files (settings write-back).
      ignored: (p: string) => p.endsWith('.tmp'),
      // Poll by default: native fs events don't cross Docker bind mounts when
      // the host edits the file (see ConfigServiceOptions.usePolling).
      usePolling: this.usePolling,
      interval: this.pollInterval,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    this.watcher = watcher;
    const onEvent = (): void => this.scheduleReload();
    watcher.on('add', onEvent).on('change', onEvent).on('unlink', onEvent);
    // Resolve only once the watcher is actually watching, so callers (and tests)
    // don't race a file edit against watcher setup.
    await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
    return snapshot;
  }

  /** Stop watching and release resources. */
  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    await this.watcher?.close();
    this.watcher = undefined;
  }

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.reload();
    }, this.debounceMs);
  }

  private async reload(): Promise<void> {
    const before = this.current;
    const snapshot = await this.load();
    this.emit('change', snapshot);
    // Note: not Node's reserved 'error' event — these are expected, non-fatal
    // validation errors, and emitting 'error' without a listener would throw.
    if (snapshot.errors.length && snapshot.errors !== before.errors) {
      this.emit('invalid', snapshot.errors);
    }
  }

  /**
   * Read and validate the config files.
   *
   * `fatal: true` means the primary config could not be parsed/validated and the
   * caller should retain last-good. A simply-missing file is not fatal — it
   * yields the empty config.
   */
  private async read(): Promise<
    | { fatal: false; config: Config; services: RawServiceCatalog; errors: string[] }
    | { fatal: true; errors: string[] }
  > {
    const errors: string[] = [];

    // Interpolation runs on parsed string leaves, never on raw text, so an env
    // value can't inject YAML structure (see interpolateTree).

    // --- openhearth.yaml (the validated primary config) ---
    let parsed: unknown = {};
    const primaryPath = path.join(this.configDir, OPENHEARTH_FILE);
    if (fs.existsSync(primaryPath)) {
      try {
        const raw = await fsp.readFile(primaryPath, 'utf8');
        parsed = interpolateTree(parseYaml(raw) ?? {}, this.env);
      } catch (err) {
        return { fatal: true, errors: [`${OPENHEARTH_FILE}: ${(err as Error).message}`] };
      }
    }

    const result = validateConfig(parsed);
    if (!result.ok) {
      return {
        fatal: true,
        errors: result.errors.map((e) => `${OPENHEARTH_FILE}: ${e}`),
      };
    }

    // --- services.yaml + services.d/*.yaml (raw; parsed by CatalogService) ---
    // Seed from last-good so a malformed file retains its previous value rather
    // than clobbering good state with undefined (NFR-4). A file that is *deleted*
    // (no longer on disk) is correctly dropped, since we only repopulate from
    // files that still exist.
    const prev = this.current.services;
    const services: RawServiceCatalog = { base: undefined, overlays: {} };
    const basePath = path.join(this.configDir, SERVICES_FILE);
    if (fs.existsSync(basePath)) {
      try {
        services.base = interpolateTree(parseYaml(await fsp.readFile(basePath, 'utf8')), this.env);
      } catch (err) {
        errors.push(`${SERVICES_FILE}: ${(err as Error).message}`);
        services.base = prev.base; // retain last-good
      }
    }
    const overlayDir = path.join(this.configDir, SERVICES_DIR);
    if (fs.existsSync(overlayDir)) {
      const entries = (await fsp.readdir(overlayDir)).filter((f) => /\.ya?ml$/.test(f)).sort();
      for (const file of entries) {
        try {
          const raw = await fsp.readFile(path.join(overlayDir, file), 'utf8');
          services.overlays[file] = interpolateTree(parseYaml(raw), this.env);
        } catch (err) {
          errors.push(`${SERVICES_DIR}/${file}: ${(err as Error).message}`);
          if (file in prev.overlays) services.overlays[file] = prev.overlays[file]; // retain last-good
        }
      }
    }

    return { fatal: false, config: result.config, services, errors };
  }
}
