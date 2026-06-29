/**
 * ConfigService.applyUiSettings — comment-preserving settings write-back (#118).
 *
 * The Settings modal persists ui.* changes by writing them into openhearth.yaml.
 * The hard guarantee is that this must NOT clobber the user's hand-written file:
 * comments, unrelated keys, and `${VAR}` secrets survive a round-trip; only the
 * touched ui.* keys change.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigService } from './ConfigService.js';

let dir: string;
let svc: ConfigService | undefined;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-writeback-'));
});

afterEach(async () => {
  await svc?.stop();
  svc = undefined;
  await fsp.rm(dir, { recursive: true, force: true });
});

function write(file: string, contents: string): void {
  fs.writeFileSync(path.join(dir, file), contents);
}
function read(file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

describe('ConfigService.applyUiSettings (#118)', () => {
  it('writes wallpaper settings and preserves comments + unrelated keys', async () => {
    write(
      'openhearth.yaml',
      [
        '# OpenHearth config — hand-edited.',
        'server:',
        '  port: 8080 # the brain',
        'metadata:',
        '  tmdbApiKey: ${TMDB_API_KEY} # secret, interpolated',
        '',
      ].join('\n'),
    );
    svc = new ConfigService({ configDir: dir, env: { TMDB_API_KEY: 'sekret' } });
    await svc.load();

    const snap = await svc.applyUiSettings({
      wallpaper: { enabled: true, image: 'wallpaper/bg.png', opacity: 0.6 },
    });

    // Snapshot reflects the change.
    expect(snap.config.ui?.wallpaper).toEqual({
      enabled: true,
      image: 'wallpaper/bg.png',
      opacity: 0.6,
    });
    // The secret is still interpolated (and never written literally as a value).
    expect(snap.config.metadata?.tmdbApiKey).toBe('sekret');

    // The file kept its comments and the literal ${VAR}, and gained ui.*.
    const text = read('openhearth.yaml');
    expect(text).toContain('# OpenHearth config — hand-edited.');
    expect(text).toContain('# the brain');
    expect(text).toContain('${TMDB_API_KEY}');
    expect(text).toContain('wallpaper/bg.png');
    expect(text).not.toContain('sekret'); // never persist the interpolated secret
  });

  it('creates the ui block when the file has none, and persists theme', async () => {
    write('openhearth.yaml', 'server:\n  port: 8080\n');
    svc = new ConfigService({ configDir: dir });
    await svc.load();

    const snap = await svc.applyUiSettings({ theme: 'light' });
    expect(snap.config.ui?.theme).toBe('light');
    expect(snap.config.server?.port).toBe(8080);
    // Re-loading from disk yields the same (it was actually written).
    const fresh = new ConfigService({ configDir: dir });
    const reloaded = await fresh.load();
    expect(reloaded.config.ui?.theme).toBe('light');
    await fresh.stop();
  });

  it('starts from empty when openhearth.yaml is absent', async () => {
    svc = new ConfigService({ configDir: dir });
    await svc.load();
    const snap = await svc.applyUiSettings({
      wallpaper: { enabled: true, image: 'wallpaper/x.png' },
    });
    expect(snap.config.ui?.wallpaper?.enabled).toBe(true);
    expect(fs.existsSync(path.join(dir, 'openhearth.yaml'))).toBe(true);
  });

  it('clears the image with a null patch but keeps other ui keys', async () => {
    write(
      'openhearth.yaml',
      'ui:\n  title: Home\n  wallpaper:\n    enabled: true\n    image: wallpaper/old.png\n',
    );
    svc = new ConfigService({ configDir: dir });
    await svc.load();

    const snap = await svc.applyUiSettings({ wallpaper: { image: null, enabled: false } });
    expect(snap.config.ui?.title).toBe('Home');
    expect(snap.config.ui?.wallpaper?.image).toBeUndefined();
    expect(snap.config.ui?.wallpaper?.enabled).toBe(false);
    expect(read('openhearth.yaml')).not.toContain('old.png');
  });

  it('writes screensaver settings and preserves comments + unrelated keys (#126)', async () => {
    write(
      'openhearth.yaml',
      ['# hand-edited', 'ui:', '  title: Home # the heading', ''].join('\n'),
    );
    svc = new ConfigService({ configDir: dir });
    await svc.load();

    const snap = await svc.applyUiSettings({
      screensaver: { enabled: true, timeoutMinutes: 15, type: 'aurora' },
    });
    expect(snap.config.ui?.screensaver).toEqual({
      enabled: true,
      timeoutMinutes: 15,
      type: 'aurora',
    });
    expect(snap.config.ui?.title).toBe('Home');

    const text = read('openhearth.yaml');
    expect(text).toContain('# hand-edited');
    expect(text).toContain('# the heading');
    expect(text).toContain('timeoutMinutes: 15');

    // Re-loading from disk yields the same (it was actually written).
    const fresh = new ConfigService({ configDir: dir });
    const reloaded = await fresh.load();
    expect(reloaded.config.ui?.screensaver?.timeoutMinutes).toBe(15);
    await fresh.stop();
  });

  it('refuses to write when the existing file has YAML syntax errors', async () => {
    write('openhearth.yaml', 'server:\n  port: [unclosed\n');
    svc = new ConfigService({ configDir: dir });
    await svc.load();
    await expect(svc.applyUiSettings({ theme: 'light' })).rejects.toThrow(/syntax/i);
  });

  it('refuses to write when the file root is not a mapping', async () => {
    write('openhearth.yaml', '- a\n- b\n'); // a sequence, not a map
    svc = new ConfigService({ configDir: dir });
    // load() reports a validation error (not a map) but doesn't throw.
    await svc.load();
    await expect(svc.applyUiSettings({ theme: 'light' })).rejects.toThrow(/mapping/i);
    // The bad file is left untouched.
    expect(read('openhearth.yaml')).toBe('- a\n- b\n');
  });

  it('serializes concurrent writes (last-applied wins, no interleave)', async () => {
    write('openhearth.yaml', 'server:\n  port: 8080\n');
    svc = new ConfigService({ configDir: dir });
    await svc.load();

    await Promise.all([
      svc.applyUiSettings({ wallpaper: { opacity: 0.2 } }),
      svc.applyUiSettings({ wallpaper: { opacity: 0.9 } }),
      svc.applyUiSettings({ theme: 'light' }),
    ]);

    const fresh = new ConfigService({ configDir: dir });
    const reloaded = await fresh.load();
    // Both keys landed (no lost update from interleaving) and the file is valid.
    expect(reloaded.errors).toEqual([]);
    expect(reloaded.config.ui?.theme).toBe('light');
    expect(typeof reloaded.config.ui?.wallpaper?.opacity).toBe('number');
    expect(reloaded.config.server?.port).toBe(8080);
    await fresh.stop();
  });
});
