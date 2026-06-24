/**
 * Server entrypoint.
 *
 * Loads config from the host-mapped `/config`, starts the config watcher, builds
 * the Fastify app, and listens on :8080. Emits structured startup diagnostics
 * (config validation summary, bound port, watched paths). No telemetry.
 */
import { buildApp } from './app.js';
import { ConfigService } from './core/ConfigService.js';

const CONFIG_DIR = process.env.OPENHEARTH_CONFIG_DIR ?? '/config';
const HOST = process.env.HOST ?? '0.0.0.0';
const WEB_ROOT = process.env.WEB_ROOT ?? '/app/public';

async function main(): Promise<void> {
  const configService = new ConfigService({ configDir: CONFIG_DIR });
  await configService.start();

  const port = configService.config.server?.port ?? Number(process.env.PORT ?? 8080);
  const app = buildApp({ configService, webRoot: WEB_ROOT });

  // Keep the active log level in sync with hot-reloaded config.
  configService.on('change', () => {
    const next = configService.config.server?.logLevel;
    if (next && app.log.level !== next) {
      app.log.level = next;
      app.log.info({ logLevel: next }, 'log level updated from config');
    }
    if (configService.errors.length) {
      app.log.warn({ errors: configService.errors }, 'config reloaded with validation errors');
    }
  });

  await app.listen({ port, host: HOST });

  // Startup diagnostics.
  app.log.info(
    {
      port,
      host: HOST,
      configDir: CONFIG_DIR,
      watching: CONFIG_DIR,
      webRoot: WEB_ROOT,
      configValid: configService.errors.length === 0,
      configErrors: configService.errors,
    },
    'OpenHearth server ready',
  );
}

main().catch((err) => {
  console.error('Fatal: failed to start OpenHearth server', err);
  process.exit(1);
});
