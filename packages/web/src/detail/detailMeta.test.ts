import { describe, it, expect } from 'vitest';
import { formatRuntime, formatRating } from './detailMeta';

describe('formatRuntime (#123)', () => {
  it('formats hours and minutes', () => {
    expect(formatRuntime(136)).toBe('2h 16m');
    expect(formatRuntime(47)).toBe('47m');
    expect(formatRuntime(120)).toBe('2h');
    expect(formatRuntime(60)).toBe('1h');
  });
  it('is empty for unknown / non-positive', () => {
    expect(formatRuntime(undefined)).toBe('');
    expect(formatRuntime(null)).toBe('');
    expect(formatRuntime(0)).toBe('');
    expect(formatRuntime(-5)).toBe('');
  });
});

describe('formatRating (#123)', () => {
  it('formats to one decimal', () => {
    expect(formatRating(8.234)).toBe('8.2');
    expect(formatRating(7)).toBe('7.0');
  });
  it('is empty for unknown / non-positive', () => {
    expect(formatRating(undefined)).toBe('');
    expect(formatRating(0)).toBe('');
  });
});
