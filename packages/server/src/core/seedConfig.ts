/**
 * Seed an empty config directory from bundled defaults on first run.
 *
 * If `configDir` is missing or empty and `seedDir` exists, copy the seed into
 * place so a fresh container comes up with a working configuration. An existing,
 * non-empty `configDir` is never touched — user edits are the source of truth.
 */
import * as fs from 'node:fs';

export interface SeedResult {
  seeded: boolean;
  reason: 'seeded' | 'config-not-empty' | 'no-seed-dir' | 'error';
  /** Present when `reason === 'error'`: the failure message. Never thrown. */
  error?: string;
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
