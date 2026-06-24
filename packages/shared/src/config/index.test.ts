import { describe, it, expect } from 'vitest';
import { validateConfig, configJsonSchema, redactConfig, REDACTED, type Config } from './index';

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

  it('rejects unknown top-level keys (strict)', () => {
    const result = validateConfig({ nope: true });
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
