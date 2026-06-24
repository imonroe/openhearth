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

const CONFIG_DIR = process.env.OPENHEARTH_CONFIG_DIR ?? '/config';
const SEED_DIR = process.env.OPENHEARTH_SEED_DIR ?? '/app/config.example';
const CACHE_DIR = process.env.OPENHEARTH_CACHE_DIR ?? '/cache';
const HOST = process.env.HOST ?? '0.0.0.0';
const WEB_ROOT = process.env.WEB_ROOT ?? '/app/public';

async function main(): Promise<void> {
  // First run: seed an empty/missing /config from the bundled defaults.
  const seed = seedConfigDir(CONFIG_DIR, SEED_DIR);

  const configService = new ConfigService({ configDir: CONFIG_DIR });
  await configService.start();

  const port = configService.config.server?.port ?? Number(process.env.PORT ?? 8080);
  const app = buildApp({ configService, webRoot: WEB_ROOT });

  // Open the disposable library/cache DB. A failure here (e.g. an unwritable
  // /cache mount) must not stop the server — local media just won't be indexed.
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
    app.log.warn(
      { cacheDir: CACHE_DIR, err },
      'could not open the cache DB (check /cache volume ownership); local library disabled',
    );
  }

  // Keep the active log level in sync with hot-reloaded config, and surface
  // changes the running process can't apply live.
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
      cacheDir: CACHE_DIR,
      seededConfig: seed.seeded,
      webRoot: WEB_ROOT,
      configValid: configService.errors.length === 0,
      configErrors: configService.errors,
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
