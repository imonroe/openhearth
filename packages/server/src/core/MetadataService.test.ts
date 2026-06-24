/**
 * MetadataService contract tests (#39): provider delegation, best-match
 * selection, the no-provider degradation path, and the config-driven factory.
 * Uses a mocked provider — no TMDB specifics, no network.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MetadataService,
  pickBestMatch,
  createMetadataProvider,
  mediaItemFromMetadata,
  type MetadataProvider,
  type MetadataResult,
} from './MetadataService.js';
import { mediaItemSchema } from '@openhearth/shared';
import { TmdbProvider } from './TmdbProvider.js';

function result(over: Partial<MetadataResult>): MetadataResult {
  return { ref: 'x:movie:1', kind: 'movie', title: 'X', artwork: {}, ...over };
}

function fakeProvider(over: Partial<MetadataProvider> = {}): MetadataProvider {
  return {
    name: 'fake',
    search: vi.fn(async () => []),
    details: vi.fn(async () => null),
    ...over,
  };
}

describe('MetadataService — with a provider', () => {
  it('delegates search and details to the provider', async () => {
    const hit = result({ ref: 'fake:movie:42', title: 'Heat', year: 1995 });
    const provider = fakeProvider({
      search: vi.fn(async () => [hit]),
      details: vi.fn(async () => hit),
    });
    const svc = new MetadataService(provider);

    expect(svc.enabled).toBe(true);
    expect(svc.providerName).toBe('fake');
    await expect(svc.search({ title: 'Heat' })).resolves.toEqual([hit]);
    await expect(svc.details('fake:movie:42')).resolves.toEqual(hit);
    expect(provider.search).toHaveBeenCalledWith({ title: 'Heat' });
  });

  it('resolve() picks the best match', async () => {
    const provider = fakeProvider({
      search: vi.fn(async () => [
        result({ ref: 'fake:movie:1', title: 'Heat', year: 1986 }),
        result({ ref: 'fake:movie:2', title: 'Heat', year: 1995 }),
      ]),
    });
    const svc = new MetadataService(provider);
    const best = await svc.resolve({ title: 'Heat', year: 1995 });
    expect(best?.ref).toBe('fake:movie:2');
  });

  it('resolve() degrades to null when the provider throws (best-effort)', async () => {
    const provider = fakeProvider({
      search: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const svc = new MetadataService(provider);
    await expect(svc.resolve({ title: 'Heat' })).resolves.toBeNull();
  });
});

describe('MetadataService — no provider (graceful degradation, NFR-9/§13.2)', () => {
  const svc = new MetadataService(null);

  it('reports disabled and returns empty/null without error', async () => {
    expect(svc.enabled).toBe(false);
    expect(svc.providerName).toBeNull();
    await expect(svc.search({ title: 'Heat' })).resolves.toEqual([]);
    await expect(svc.details('x')).resolves.toBeNull();
    await expect(svc.resolve({ title: 'Heat', year: 1995 })).resolves.toBeNull();
  });
});

describe('pickBestMatch', () => {
  it('prefers exact title + year, then exact title, then first', () => {
    const list = [
      result({ ref: 'a', title: 'The Thing', year: 2011 }),
      result({ ref: 'b', title: 'The Thing', year: 1982 }),
      result({ ref: 'c', title: 'Thing', year: 1982 }),
    ];
    expect(pickBestMatch(list, { title: 'The Thing', year: 1982 })?.ref).toBe('b');
    expect(pickBestMatch(list, { title: 'the thing' })?.ref).toBe('a'); // exact title, first
    expect(pickBestMatch(list, { title: 'nope' })?.ref).toBe('a'); // fallback: first
    expect(pickBestMatch([], { title: 'x' })).toBeNull();
  });
});

describe('mediaItemFromMetadata (#40 normalized model)', () => {
  it('maps a movie result, deriving ids from the ref and schema-valid output', () => {
    const item = mediaItemFromMetadata(
      result({
        ref: 'tmdb:movie:603',
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        overview: 'A hacker learns the truth.',
        artwork: { poster_url: 'https://img/p.jpg', backdrop_url: 'https://img/b.jpg' },
      }),
    );
    expect(item).toEqual({
      id: 'tmdb:movie:603',
      title: 'The Matrix',
      kind: 'movie',
      year: 1999,
      overview: 'A hacker learns the truth.',
      artwork: { poster_url: 'https://img/p.jpg', backdrop_url: 'https://img/b.jpg' },
      ids: { tmdb: '603' },
    });
    expect(mediaItemSchema.safeParse(item).success).toBe(true);
  });

  it('maps tv → the provider-agnostic series kind and omits absent fields', () => {
    const item = mediaItemFromMetadata(
      result({ ref: 'tmdb:tv:1396', kind: 'tv', title: 'Breaking Bad', artwork: {} }),
    );
    expect(item.kind).toBe('series');
    expect(item.year).toBeUndefined();
    expect(item.artwork).toBeUndefined();
    expect(item.ids).toEqual({ tmdb: '1396' });
  });
});

describe('createMetadataProvider', () => {
  it('returns null when metadata is unconfigured', () => {
    expect(createMetadataProvider(undefined)).toBeNull();
    expect(createMetadataProvider({})).toBeNull();
  });

  it('returns null when the provider is tmdb but the key is missing (graceful)', () => {
    expect(createMetadataProvider({ provider: 'tmdb' })).toBeNull();
  });

  it('builds a TmdbProvider when a key is present', () => {
    const p = createMetadataProvider({ provider: 'tmdb', tmdbApiKey: 'k' });
    expect(p).toBeInstanceOf(TmdbProvider);
    expect(p?.name).toBe('tmdb');
  });
});
