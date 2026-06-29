/**
 * TmdbProvider tests (#39) — fully offline via an injected fetch. Cover the
 * neutral mapping (movie + tv), the request parameters (key/language/year,
 * include_adult, and NFR-9: nothing else), details round-trip, 404 → null, and
 * the 429 Retry-After retry. `sleep` is stubbed so nothing actually waits.
 */
import { describe, it, expect, vi } from 'vitest';
import { TmdbProvider } from './TmdbProvider.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const MOVIE = {
  id: 603,
  title: 'The Matrix',
  release_date: '1999-03-31',
  overview: 'A hacker learns the truth.',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
};
const TV = {
  id: 1396,
  name: 'Breaking Bad',
  first_air_date: '2008-01-20',
  poster_path: '/bb.jpg',
  backdrop_path: null,
};

function provider(fetchImpl: typeof globalThis.fetch, opts = {}) {
  return new TmdbProvider({
    apiKey: 'secret-key',
    language: 'en-US',
    fetch: fetchImpl,
    sleep: async () => {}, // never actually wait
    minIntervalMs: 0,
    ...opts,
  });
}

describe('TmdbProvider.search', () => {
  it('maps a movie result to the neutral shape with absolute artwork URLs', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [MOVIE] }));
    // kind hint = movie → single endpoint.
    const out = await provider(fetchImpl).search({ title: 'The Matrix', kind: 'movie' });

    expect(out).toEqual([
      {
        ref: 'tmdb:movie:603',
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        overview: 'A hacker learns the truth.',
        artwork: {
          poster_url: 'https://image.tmdb.org/t/p/w500/poster.jpg',
          backdrop_url: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
        },
      },
    ]);
  });

  it('maps a tv result (name/first_air_date) and omits absent artwork', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [TV] }));
    const out = await provider(fetchImpl).search({ title: 'Breaking Bad', kind: 'tv' });
    expect(out[0]).toMatchObject({
      ref: 'tmdb:tv:1396',
      kind: 'tv',
      title: 'Breaking Bad',
      year: 2008,
    });
    expect(out[0]?.artwork).toEqual({ poster_url: 'https://image.tmdb.org/t/p/w500/bb.jpg' });
  });

  it('sends only key, language, include_adult=false, query (+year) — no identity (NFR-9)', async () => {
    const fetchImpl = vi.fn<(input: string | URL | Request) => Promise<Response>>(async () =>
      jsonResponse({ results: [] }),
    );
    await provider(fetchImpl).search({ title: 'Heat', year: 1995, kind: 'movie' });

    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe('https://api.themoviedb.org/3/search/movie');
    expect(url.searchParams.get('api_key')).toBe('secret-key');
    expect(url.searchParams.get('language')).toBe('en-US');
    expect(url.searchParams.get('include_adult')).toBe('false');
    expect(url.searchParams.get('query')).toBe('Heat');
    expect(url.searchParams.get('year')).toBe('1995');
    expect([...url.searchParams.keys()].sort()).toEqual([
      'api_key',
      'include_adult',
      'language',
      'query',
      'year',
    ]);
  });

  it('searches both movie and tv when no kind hint is given', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const u = new URL(typeof input === 'string' ? input : input.toString());
      return u.pathname.endsWith('/search/movie')
        ? jsonResponse({ results: [MOVIE] })
        : jsonResponse({ results: [TV] });
    });
    const out = await provider(fetchImpl).search({ title: 'x' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.map((r) => r.ref).sort()).toEqual(['tmdb:movie:603', 'tmdb:tv:1396']);
  });

  it('drops records with no usable title', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ results: [{ id: 1 }, { id: 2, title: 'Real' }] }),
    );
    const out = await provider(fetchImpl).search({ title: 'x', kind: 'movie' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ref: 'tmdb:movie:2', title: 'Real' });
  });

  it('returns [] for a blank title without calling the network', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
    expect(await provider(fetchImpl).search({ title: '   ' })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('TmdbProvider.details', () => {
  it('round-trips a ref to /movie/:id', async () => {
    const fetchImpl = vi.fn<(input: string | URL | Request) => Promise<Response>>(async () =>
      jsonResponse(MOVIE),
    );
    const out = await provider(fetchImpl).details('tmdb:movie:603');
    expect(out?.title).toBe('The Matrix');
    expect(new URL(fetchImpl.mock.calls[0]![0] as string).pathname).toBe('/3/movie/603');
  });

  it('returns null for a malformed ref without calling the network', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MOVIE));
    expect(await provider(fetchImpl).details('bogus')).toBeNull();
    expect(await provider(fetchImpl).details('other:movie:1')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps a 404 to null', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 404 }));
    expect(await provider(fetchImpl).details('tmdb:movie:999')).toBeNull();
  });

  it('requests credits and maps the rich detail fields (#123)', async () => {
    const fetchImpl = vi.fn<(input: string | URL | Request) => Promise<Response>>(async () =>
      jsonResponse({
        ...MOVIE,
        runtime: 136,
        tagline: 'Welcome to the Real World.',
        vote_average: 8.234,
        genres: [
          { id: 1, name: 'Science Fiction' },
          { id: 2, name: 'Action' },
        ],
        credits: {
          cast: [
            { name: 'Keanu Reeves', character: 'Neo', profile_path: '/keanu.jpg' },
            { name: 'Carrie-Anne Moss', character: 'Trinity', profile_path: null },
            { name: '' }, // dropped (no usable name)
          ],
          crew: [
            { name: 'Lana Wachowski', job: 'Director' },
            { name: 'Lilly Wachowski', job: 'Director' },
            { name: 'Joel Silver', job: 'Producer' }, // not a director
          ],
        },
      }),
    );
    const out = await provider(fetchImpl).details('tmdb:movie:603');
    // The single details request carries append_to_response=credits.
    expect(
      new URL(fetchImpl.mock.calls[0]![0] as string).searchParams.get('append_to_response'),
    ).toBe('credits');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out?.runtime_minutes).toBe(136);
    expect(out?.tagline).toBe('Welcome to the Real World.');
    expect(out?.rating).toBe(8.2); // rounded to 1dp
    expect(out?.genres).toEqual(['Science Fiction', 'Action']);
    expect(out?.directors).toEqual(['Lana Wachowski', 'Lilly Wachowski']);
    expect(out?.cast).toEqual([
      {
        name: 'Keanu Reeves',
        character: 'Neo',
        profile_url: 'https://image.tmdb.org/t/p/w185/keanu.jpg',
      },
      { name: 'Carrie-Anne Moss', character: 'Trinity' },
    ]);
  });

  it('maps a tv episode runtime and omits empty rich fields', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...TV, episode_run_time: [47], vote_average: 0, genres: [] }),
    );
    const out = await provider(fetchImpl).details('tmdb:tv:1396');
    expect(out?.runtime_minutes).toBe(47);
    expect(out?.rating).toBeUndefined(); // 0 → omitted
    expect(out?.genres).toBeUndefined();
    expect(out?.cast).toBeUndefined();
  });
});

describe('TmdbProvider rate limiting', () => {
  it('retries once after a 429, honoring Retry-After', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({}, { status: 429, headers: { 'retry-after': '2' } })
        : jsonResponse({ results: [MOVIE] });
    });
    const out = await provider(fetchImpl, { sleep }).search({ title: 'x', kind: 'movie' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(out[0]?.ref).toBe('tmdb:movie:603');
  });

  it('throws on a non-retryable HTTP error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 401 }));
    await expect(provider(fetchImpl).search({ title: 'x', kind: 'movie' })).rejects.toThrow(/401/);
  });
});
