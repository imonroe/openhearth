/**
 * Seed an empty config directory from bundled defaults on first run.
 *
 * If `configDir` is missing or empty and `seedDir` exists, copy the seed into
 * place so a fresh container comes up with a working configuration. An existing,
 * non-empty `configDir` is never touched — user edits are the source of truth.
 *
 * If `configDir` is non-empty but lacks the primary config file
 * (`openhearth.yaml`), it reports a specific warning reason — the most common
 * cause is copying the `config.example/` folder itself into the volume instead
 * of its contents, creating a `config.example/` subdirectory where the server
 * expects the files directly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SeedResult {
  seeded: boolean;
  reason:
    | 'seeded'
    | 'config-not-empty'
    | 'config-nonempty-missing-primary'
    | 'no-seed-dir'
    | 'error';
  /** Present when `reason === 'error'`: the failure message. Never thrown. */
  error?: string;
  /** Present when `reason === 'config-nonempty-missing-primary'`: help text for the likely cause. */
  hint?: string;
}

function isEmptyOrMissing(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length === 0;
  } catch {
    return true; // missing directory counts as empty
  }
}

/**
 * Seed `configDir` from `seedDir`. Never throws: a failure (e.g. EACCES on a
 * root-owned bind mount) is returned as `reason: 'error'` so the caller can log
 * a non-fatal warning and continue with all-defaults — config problems must
 * never crash the server (NFR-4).
 */
export function seedConfigDir(configDir: string, seedDir: string): SeedResult {
  if (!isEmptyOrMissing(configDir)) {
    // Directory is non-empty — user config should take priority. But if the
    // primary file is missing, surface a specific warning: the most common cause
    // is copying the seed folder itself instead of its contents, creating a
    // nested `config.example/` subdirectory.
    const primaryPath = path.join(configDir, 'openhearth.yaml');
    if (!fs.existsSync(primaryPath)) {
      const hasConfigExample = fs.existsSync(path.join(configDir, 'config.example'));
      return {
        seeded: false,
        reason: 'config-nonempty-missing-primary',
        hint: hasConfigExample
          ? `Expected ${primaryPath} and ${path.join(configDir, 'services.yaml')}. ` +
            `Found a "config.example/" subfolder — copy its *contents* into ${configDir} instead ` +
            `(e.g., "cp -r config.example/. config/"). Continuing with defaults.`
          : `Expected ${primaryPath} (not found). Continuing with defaults.`,
      };
    }
    return { seeded: false, reason: 'config-not-empty' };
  }
  if (!fs.existsSync(seedDir)) {
    return { seeded: false, reason: 'no-seed-dir' };
  }
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.cpSync(seedDir, configDir, { recursive: true });
    return { seeded: true, reason: 'seeded' };
  } catch (err) {
    return { seeded: false, reason: 'error', error: (err as Error).message };
  }
}
