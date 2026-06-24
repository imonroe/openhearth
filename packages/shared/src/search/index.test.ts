/**
 * Search contract tests (#43): the response shape validates, and the section
 * grouping is extensible to future (non-`library`) sources without a change.
 */
import { describe, it, expect } from 'vitest';
import { searchResponseSchema, type SearchResponse } from './index.js';

describe('searchResponseSchema', () => {
  it('validates a library-only response', () => {
    const res: SearchResponse = {
      query: 'matrix',
      sections: [
        {
          source: 'library',
          label: 'Your Library',
          items: [{ id: 'lib-1', title: 'The Matrix', kind: 'movie', year: 1999 }],
        },
      ],
      total: 1,
    };
    expect(searchResponseSchema.safeParse(res).success).toBe(true);
  });

  it('accepts additional sections from a future source (extensible)', () => {
    const res = {
      query: 'matrix',
      sections: [
        { source: 'library', label: 'Your Library', items: [] },
        // A future cross-service source slots in as another section unchanged.
        {
          source: 'tmdb',
          label: 'Discover',
          items: [{ id: 'tmdb:movie:603', title: 'The Matrix', kind: 'movie' }],
        },
      ],
      total: 1,
    };
    expect(searchResponseSchema.safeParse(res).success).toBe(true);
  });

  it('rejects unknown top-level keys (strict)', () => {
    expect(
      searchResponseSchema.safeParse({ query: 'x', sections: [], total: 0, bogus: 1 }).success,
    ).toBe(false);
  });
});
