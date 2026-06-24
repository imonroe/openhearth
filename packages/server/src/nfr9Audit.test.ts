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

/**
 * Outbound-network primitives we forbid outside the allowlist. Any real outbound
 * call must enter the system through one of these tokens *somewhere* — even when
 * the call is later made through an injected `fetch`, the real `globalThis.fetch`
 * (or a node net module / HTTP lib) has to be referenced at its root, which is
 * what these catch.
 */
const FORBIDDEN = [
  // `globalThis.fetch` as a value/call, but NOT `typeof globalThis.fetch` (a type
  // annotation — interfaces forwarding an injectable fetch don't call the network).
  /(?<!typeof )globalThis\.fetch/,
  /(?<![A-Za-z.])fetch\s*\(/, // a bare fetch( call (not this.fetchImpl/opts.fetch)
  /\bhttps?\.(?:get|request)\b/, // http(s).get / .request
  /\bnet\.(?:connect|createConnection)\b/,
  /\b(?:tls|dgram)\.[a-z]/, // tls.connect, dgram sockets
  /\bdns\./,
  /\bnew\s+WebSocket\b/,
  // Static/dynamic import or require of a node networking module…
  /['"]node:(?:http|https|net|dns|tls|dgram)['"]/,
  // …or a third-party HTTP client (none are deps — flag if one sneaks in).
  /['"](?:axios|got|node-fetch|undici|superagent|needle|phin)['"]/,
];

/** A primitive every allowlisted module must still contain (so the guard stays real). */
const ALLOWED_PRIMITIVE = /globalThis\.fetch/;

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
    const files = sourceFiles(here);
    // Guard against a vacuous pass: if the scan found nothing (wrong dir, etc.)
    // the empty-offenders assertion would falsely succeed.
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
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

  it('the allowlisted modules still exist and contain a network primitive', () => {
    // If a TmdbProvider/ArtworkCache refactor moves the call off globalThis.fetch
    // (e.g. to http.request), this fails loudly — forcing the allowlist + patterns
    // to be re-examined rather than silently trusting a stale guard.
    for (const rel of ALLOWED) {
      const file = path.join(here, rel);
      expect(fs.existsSync(file)).toBe(true);
      expect(ALLOWED_PRIMITIVE.test(fs.readFileSync(file, 'utf8'))).toBe(true);
    }
  });
});
