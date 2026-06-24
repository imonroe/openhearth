/**
 * AuthGuard + token extraction (#47). Off when no token; constant-time accept
 * when set; token pulled from Authorization: Bearer or ?token=.
 */
import { describe, it, expect } from 'vitest';
import { AuthGuard, tokenFromRequest } from './auth.js';

describe('AuthGuard', () => {
  it('is disabled (accepts everything) with no token', () => {
    const g = new AuthGuard(undefined);
    expect(g.enabled).toBe(false);
    expect(g.accepts(undefined)).toBe(true);
    expect(g.accepts('anything')).toBe(true);
  });

  it('treats a blank/whitespace token as disabled', () => {
    expect(new AuthGuard('').enabled).toBe(false);
    expect(new AuthGuard('   ').enabled).toBe(false);
  });

  it('accepts only the exact token when enabled', () => {
    const g = new AuthGuard('s3cret');
    expect(g.enabled).toBe(true);
    expect(g.accepts('s3cret')).toBe(true);
    expect(g.accepts('wrong')).toBe(false);
    expect(g.accepts('s3cre')).toBe(false); // different length
    expect(g.accepts('s3cret ')).toBe(false); // trailing space differs
    expect(g.accepts('')).toBe(false);
    expect(g.accepts(undefined)).toBe(false);
    expect(g.accepts(null)).toBe(false);
  });

  it('trims the configured token', () => {
    expect(new AuthGuard('  tok  ').accepts('tok')).toBe(true);
  });
});

describe('tokenFromRequest', () => {
  it('reads a Bearer header (case-insensitive scheme)', () => {
    expect(tokenFromRequest({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
    expect(tokenFromRequest({ headers: { authorization: 'bearer abc' } })).toBe('abc');
  });

  it('falls back to a ?token= query param', () => {
    expect(tokenFromRequest({ headers: {}, query: { token: 'q123' } })).toBe('q123');
  });

  it('prefers the header over the query', () => {
    expect(
      tokenFromRequest({ headers: { authorization: 'Bearer h' }, query: { token: 'q' } }),
    ).toBe('h');
  });

  it('handles duplicated (array) values and missing tokens', () => {
    expect(tokenFromRequest({ headers: {}, query: { token: ['a', 'b'] } })).toBe('a');
    expect(tokenFromRequest({ headers: {} })).toBeUndefined();
    expect(tokenFromRequest({ headers: { authorization: 'Basic x' } })).toBeUndefined();
  });
});
