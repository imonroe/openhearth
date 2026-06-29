import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  configJsonSchema,
  redactConfig,
  REDACTED,
  uiSettingsPatchSchema,
  wallpaperUploadSchema,
  type Config,
} from './index';

describe('config', () => {
  it('accepts an empty config (app usable with nothing configured)', () => {
    const result = validateConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual({});
  });

  it('accepts a populated config', () => {
    const sample: Config = {
      server: { port: 8080, logLevel: 'info' },
      metadata: { tmdbApiKey: 'abc123' },
    };
    const result = validateConfig(sample);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(sample);
  });

  it('rejects an out-of-range port with a path-scoped message', () => {
    const result = validateConfig({ server: { port: 70000 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith('server.port'))).toBe(true);
    }
  });

  it('produces clear, path-scoped messages for multiple malformed fields', () => {
    const result = validateConfig({
      server: { port: 'nope' }, // wrong type
      ui: { theme: 'neon' }, // invalid enum
      unknownTop: 1, // unknown key (strict)
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Each message is "<path>: <human-readable reason>".
      expect(result.errors.every((e) => /^[\w.()]+: .+/.test(e))).toBe(true);
      expect(result.errors.some((e) => e.startsWith('server.port'))).toBe(true);
      expect(result.errors.some((e) => e.startsWith('ui.theme'))).toBe(true);
    }
  });

  it('rejects unknown top-level keys (strict)', () => {
    const result = validateConfig({ nope: true });
    expect(result.ok).toBe(false);
  });

  it('accepts the full PRD-shaped config (ui/library/keybindings)', () => {
    const result = validateConfig({
      ui: { title: 'OpenHearth', theme: 'dark', rows: [{ type: 'services', group: 'Streaming' }] },
      library: { sources: [{ id: 'movies', path: '/media/movies', kind: 'movies' }] },
      metadata: { provider: 'tmdb', language: 'en-US' },
      keybindings: { up: ['ArrowUp'], home: ['Home'] },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid ui row type', () => {
    const result = validateConfig({ ui: { rows: [{ type: 'bogus' }] } });
    expect(result.ok).toBe(false);
  });

  it('never throws on non-object input', () => {
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig('not a config').ok).toBe(false);
  });

  it('emits a JSON Schema for docs/tooling', () => {
    expect(configJsonSchema).toBeTypeOf('object');
  });
});

describe('ui.wallpaper (#118)', () => {
  it('accepts a full wallpaper block', () => {
    const result = validateConfig({
      ui: { wallpaper: { enabled: true, image: 'wallpaper/background-1.png', opacity: 0.8 } },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a partial wallpaper block (every field optional)', () => {
    expect(validateConfig({ ui: { wallpaper: { enabled: false } } }).ok).toBe(true);
    expect(validateConfig({ ui: { wallpaper: {} } }).ok).toBe(true);
  });

  it('rejects opacity outside 0..1', () => {
    expect(validateConfig({ ui: { wallpaper: { opacity: 1.5 } } }).ok).toBe(false);
    expect(validateConfig({ ui: { wallpaper: { opacity: -0.1 } } }).ok).toBe(false);
  });

  it('rejects unknown wallpaper keys (strict)', () => {
    expect(validateConfig({ ui: { wallpaper: { url: 'http://x/y.png' } } }).ok).toBe(false);
  });
});

describe('ui.screensaver (#126)', () => {
  it('accepts a full screensaver block', () => {
    expect(
      validateConfig({
        ui: { screensaver: { enabled: true, timeoutMinutes: 10, type: 'aurora' } },
      }).ok,
    ).toBe(true);
  });

  it('accepts a partial screensaver block (every field optional)', () => {
    expect(validateConfig({ ui: { screensaver: { enabled: false } } }).ok).toBe(true);
    expect(validateConfig({ ui: { screensaver: {} } }).ok).toBe(true);
  });

  it('rejects a non-integer or out-of-range timeout', () => {
    expect(validateConfig({ ui: { screensaver: { timeoutMinutes: 0 } } }).ok).toBe(false);
    expect(validateConfig({ ui: { screensaver: { timeoutMinutes: 2.5 } } }).ok).toBe(false);
    expect(validateConfig({ ui: { screensaver: { timeoutMinutes: 100000 } } }).ok).toBe(false);
  });

  it('rejects an unknown screensaver type and unknown keys (strict)', () => {
    expect(validateConfig({ ui: { screensaver: { type: 'matrix' } } }).ok).toBe(false);
    expect(validateConfig({ ui: { screensaver: { speed: 'fast' } } }).ok).toBe(false);
  });
});

describe('uiSettingsPatchSchema (PUT /api/v1/ui/settings)', () => {
  it('accepts theme and wallpaper enabled/opacity', () => {
    expect(uiSettingsPatchSchema.safeParse({ theme: 'light' }).success).toBe(true);
    expect(
      uiSettingsPatchSchema.safeParse({ wallpaper: { enabled: true, opacity: 0.5 } }).success,
    ).toBe(true);
    expect(uiSettingsPatchSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a screensaver patch (#126)', () => {
    expect(
      uiSettingsPatchSchema.safeParse({ screensaver: { enabled: true, timeoutMinutes: 15 } })
        .success,
    ).toBe(true);
    expect(uiSettingsPatchSchema.safeParse({ screensaver: { type: 'aurora' } }).success).toBe(true);
  });

  it('rejects an invalid screensaver patch', () => {
    expect(uiSettingsPatchSchema.safeParse({ screensaver: { type: 'nope' } }).success).toBe(false);
    expect(uiSettingsPatchSchema.safeParse({ screensaver: { timeoutMinutes: -1 } }).success).toBe(
      false,
    );
  });

  it('does NOT accept a free-form wallpaper image path (set only by upload)', () => {
    expect(
      uiSettingsPatchSchema.safeParse({ wallpaper: { image: '../../etc/passwd' } }).success,
    ).toBe(false);
  });

  it('rejects an invalid theme and out-of-range opacity', () => {
    expect(uiSettingsPatchSchema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(uiSettingsPatchSchema.safeParse({ wallpaper: { opacity: 2 } }).success).toBe(false);
  });
});

describe('wallpaperUploadSchema (POST /api/v1/ui/wallpaper)', () => {
  it('accepts an allowed content type with base64 data', () => {
    expect(
      wallpaperUploadSchema.safeParse({ content_type: 'image/png', data_base64: 'iVBOR' }).success,
    ).toBe(true);
  });

  it('rejects a disallowed content type', () => {
    expect(
      wallpaperUploadSchema.safeParse({ content_type: 'image/svg+xml', data_base64: 'x' }).success,
    ).toBe(false);
  });

  it('rejects an empty payload', () => {
    expect(
      wallpaperUploadSchema.safeParse({ content_type: 'image/png', data_base64: '' }).success,
    ).toBe(false);
  });
});

describe('redactConfig', () => {
  it('redacts a configured secret leaf', () => {
    const redacted = redactConfig({ metadata: { tmdbApiKey: 'super-secret' } });
    expect(redacted.metadata?.tmdbApiKey).toBe(REDACTED);
  });

  it('leaves unset secrets absent and does not mutate the source', () => {
    const source: Config = { server: { port: 8080 } };
    const redacted = redactConfig(source);
    expect(redacted.metadata).toBeUndefined();
    expect(source).toEqual({ server: { port: 8080 } });
  });

  it('preserves non-secret fields', () => {
    const redacted = redactConfig({
      server: { port: 8080, logLevel: 'info' },
      metadata: { tmdbApiKey: 'k' },
    });
    expect(redacted.server).toEqual({ port: 8080, logLevel: 'info' });
    expect(redacted.metadata?.tmdbApiKey).toBe(REDACTED);
  });
});
