/**
 * NFR-9 "no phone-home" audit (#48). OpenHearth must make **no** outbound network
 * calls except the user-configured metadata provider (TMDB), using the user's own
 * key. This test scans the server source for outbound-network primitives and
 * fails if any appear outside the allowlisted, user-config-gated modules — a
 * standing guard so a future stray `fetch`/`http.request` can't quietly ship.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Modules permitted to perform outbound network I/O — both gated on user config. */
const ALLOWED = new Set([
  'core/TmdbProvider.ts', // TMDB lookups: only when a provider key is configured
  'core/ArtworkCache.ts', // poster download: only for a TMDB URL the user resolved
]);

/** Outbound-network primitives we forbid outside the allowlist. */
const FORBIDDEN = [
  // `globalThis.fetch` as a value/call, but NOT `typeof globalThis.fetch` (a type
  // annotation — interfaces forwarding an injectable fetch don't call the network).
  /(?<!typeof )globalThis\.fetch/,
  /(?<![A-Za-z.])fetch\s*\(/, // a bare fetch( call (not this.fetchImpl/opts.fetch)
  /\bhttps?\.request\b/,
  /\bnet\.(?:connect|createConnection)\b/,
  /\bnew\s+WebSocket\b/,
  /\bdns\./,
];

/** Recursively list .ts source files (excluding tests). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('NFR-9: no phone-home', () => {
  it('only the allowlisted modules contain outbound-network primitives', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(here)) {
      const rel = path.relative(here, file).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        const m = pattern.exec(text);
        if (m) offenders.push(`${rel}: matched ${pattern} ("${m[0]}")`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the allowlisted modules still exist (guard stays meaningful)', () => {
    for (const rel of ALLOWED) {
      expect(fs.existsSync(path.join(here, rel))).toBe(true);
    }
  });
});
