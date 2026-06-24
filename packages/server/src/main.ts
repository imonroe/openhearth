/**
 * Server entrypoint.
 *
 * Loads config from the host-mapped `/config`, starts the config watcher, builds
 * the Fastify app, and listens on :8080. Emits structured startup diagnostics
 * (config validation summary, bound port, watched paths). No telemetry.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';
import { seedConfigDir } from './core/seedConfig.js';
import { CacheStore } from './core/CacheStore.js';
import { LibraryService } from './core/LibraryService.js';
import { TranscodeService } from './core/TranscodeService.js';
import { createMetadataProvider, MetadataService } from './core/MetadataService.js';
import { ArtworkCache } from './core/ArtworkCache.js';
import { primeLibraryMetadata } from './core/enrichLibrary.js';

const CONFIG_DIR = process.env.OPENHEARTH_CONFIG_DIR ?? '/config';
const SEED_DIR = process.env.OPENHEARTH_SEED_DIR ?? '/app/config.example';
const CACHE_DIR = process.env.OPENHEARTH_CACHE_DIR ?? '/cache';
const WEB_ROOT = process.env.WEB_ROOT ?? '/app/public';
// Bundled service-icon set (referenced by `icon: bundled:<slug>`). Shipped into
// the image at /app/service-icons; override the path for a source checkout.
const ICONS_DIR = process.env.OPENHEARTH_ICONS_DIR ?? '/app/service-icons';
// Hot-reload `/config` by polling (default on): native fs events don't cross
// Docker bind mounts when the host edits the file. Set OPENHEARTH_CONFIG_POLL=0
// (or `false`) on a host where native events work to avoid the polling cost.
const CONFIG_POLL = !/^(0|false|no)$/i.test(process.env.OPENHEARTH_CONFIG_POLL ?? '');

async function main(): Promise<void> {
  // First run: seed an empty/missing /config from the bundled defaults.
  const seed = seedConfigDir(CONFIG_DIR, SEED_DIR);

  const configService = new ConfigService({ configDir: CONFIG_DIR, usePolling: CONFIG_POLL });
  await configService.start();

  const port = configService.config.server?.port ?? Number(process.env.PORT ?? 8080);
  // Bind address (#47): env HOST wins, then config `server.host`, then all
  // interfaces. Restrict to `127.0.0.1` (config or env) to keep the server off
  // the LAN; pair LAN exposure with `server.auth.token`.
  const HOST = process.env.HOST ?? configService.config.server?.host ?? '0.0.0.0';

  // Open the disposable library/cache DB before building the app so the library
  // routes can serve it. A failure here (e.g. an unwritable /cache mount) must
  // not stop the server — local media just won't be indexed, and the library
  // endpoints degrade to an empty listing.
  let cacheStore: CacheStore | null = null;
  let libraryService: LibraryService | null = null;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    cacheStore = new CacheStore(path.join(CACHE_DIR, 'openhearth.db'));
    libraryService = new LibraryService({
      store: cacheStore,
      getSources: () => configService.config.library?.sources ?? [],
    });
  } catch (err) {
    console.error('OpenHearth: could not open the cache DB; local library disabled', err);
  }

  // Transcoder for the stream endpoint (uses the runtime image's ffmpeg/ffprobe).
  const streamer = new TranscodeService({
    ...(configService.config.transcode ? { transcode: configService.config.transcode } : {}),
  });

  // Metadata + artwork (#42). Backed by the same disposable cache; degrades to a
  // no-op when no provider key is configured. Both are skipped if the cache DB
  // couldn't be opened (no place to cache, no library to enrich).
  let metadataService: MetadataService | null = null;
  let artworkCache: ArtworkCache | null = null;
  if (cacheStore) {
    const provider = createMetadataProvider(configService.config.metadata);
    metadataService = new MetadataService(provider, { cache: cacheStore });
    artworkCache = new ArtworkCache({ dir: path.join(CACHE_DIR, 'artwork') });
  }

  const app = buildApp({
    configService,
    webRoot: WEB_ROOT,
    iconsDir: ICONS_DIR,
    streamer,
    ...(libraryService ? { libraryService } : {}),
    ...(metadataService ? { metadataService } : {}),
    ...(artworkCache ? { artworkCache } : {}),
  });

  /** Prime the metadata cache for the current library, in the background. */
  const primeMetadata = (): void => {
    if (!metadataService?.enabled || !libraryService) return;
    void primeLibraryMetadata(libraryService.list({}), {
      metadataService,
      ...(artworkCache ? { artworkCache } : {}),
      onError: (err) => app.log.debug({ err }, 'metadata prime: item failed'),
    })
      .then((resolved) => app.log.info({ resolved }, 'metadata prime complete'))
      .catch((err) => app.log.warn({ err }, 'metadata prime failed'));
  };

  // Keep the active log level in sync with hot-reloaded config, and surface
  // changes the running process can't apply live.
  let lastSources = JSON.stringify(configService.config.library?.sources ?? []);
  configService.on('change', () => {
    const next = configService.config.server?.logLevel;
    if (next && app.log.level !== next) {
      app.log.level = next;
      app.log.info({ logLevel: next }, 'log level updated from config');
    }
    const nextPort = configService.config.server?.port;
    if (nextPort && nextPort !== port) {
      app.log.warn(
        { configuredPort: nextPort, activePort: port },
        'server.port changed in config; a restart is required for it to take effect',
      );
    }
    if (configService.errors.length) {
      app.log.warn({ errors: configService.errors }, 'config reloaded with validation errors');
    }
    // Re-index when the library sources change (added/removed/repointed), so a
    // hot-edited path takes effect without a restart. Skipped when sources are
    // unchanged to avoid a needless walk on unrelated config edits.
    const sources = JSON.stringify(configService.config.library?.sources ?? []);
    if (libraryService && sources !== lastSources) {
      lastSources = sources;
      setImmediate(() => {
        try {
          const summary = libraryService.scan();
          app.log.info(
            { totalIndexed: summary.totalIndexed },
            'library re-indexed after config change',
          );
          primeMetadata();
        } catch (err) {
          app.log.warn({ err }, 'library re-scan failed');
        }
      });
    }
  });

  // Graceful shutdown: close the HTTP server, the config watcher, and the cache.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void Promise.allSettled([app.close(), configService.stop()]).then(() => {
        cacheStore?.close();
        process.exit(0);
      });
    });
  }

  // Surface a seed failure as a non-fatal warning — the server still came up on
  // all-defaults rather than crashing (e.g. EACCES on a root-owned /config).
  if (seed.reason === 'error') {
    app.log.warn(
      { configDir: CONFIG_DIR, error: seed.error },
      'could not seed /config (check volume ownership); continuing with current config',
    );
  }

  try {
    await app.listen({ port, host: HOST });
  } catch (err) {
    app.log.fatal({ err }, 'failed to bind server');
    throw err;
  }

  // Startup diagnostics.
  app.log.info(
    {
      port,
      host: HOST,
      configDir: CONFIG_DIR,
      watching: CONFIG_DIR,
      configPolling: CONFIG_POLL,
      cacheDir: CACHE_DIR,
      seededConfig: seed.seeded,
      webRoot: WEB_ROOT,
      configValid: configService.errors.length === 0,
      configErrors: configService.errors,
      // Whether shared-token auth is on (never the token itself).
      authEnabled: Boolean(configService.config.server?.auth?.token),
      // Metadata provider configured (reachability is confirmed lazily on first
      // lookup, not pinged at boot — no speculative outbound call; NFR-9).
      metadataProvider: metadataService?.providerName ?? null,
    },
    'OpenHearth server ready',
  );

  // Build the local library index after the server is listening so health is
  // green immediately. The scan is best-effort: a bad source path is reported
  // per-source and never crashes the process (NFR-4 spirit).
  if (libraryService) {
    setImmediate(() => {
      try {
        const summary = libraryService.scan();
        app.log.info(
          { totalIndexed: summary.totalIndexed, sources: summary.sources },
          'library scan complete',
        );
        primeMetadata();
      } catch (err) {
        app.log.warn({ err }, 'library scan failed');
      }
    });
  }
}

main().catch((err) => {
  console.error('Fatal: failed to start OpenHearth server', err);
  process.exit(1);
});
