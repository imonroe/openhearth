import { describe, it, expect } from 'vitest';
import {
  findSidecarSubtitles,
  srtToVtt,
  parseSubtitleStreams,
  buildSubtitleExtractArgs,
} from './subtitles.js';

describe('findSidecarSubtitles', () => {
  const dir = [
    'Heat (1995).mkv',
    'Heat (1995).srt',
    'Heat (1995).en.srt',
    'Heat (1995).fr.vtt',
    'Heat (1995).en.forced.srt',
    'Other Movie.srt',
    'Heat (1995).nfo',
  ];

  it('matches the plain sidecar and language-suffixed ones', () => {
    const subs = findSidecarSubtitles('Heat (1995).mkv', dir);
    expect(subs.map((s) => [s.filename, s.format, s.lang])).toEqual([
      ['Heat (1995).en.forced.srt', 'srt', 'en.forced'],
      ['Heat (1995).en.srt', 'srt', 'en'],
      ['Heat (1995).fr.vtt', 'vtt', 'fr'],
      ['Heat (1995).srt', 'srt', undefined],
    ]);
  });

  it('does not match a different movie or non-subtitle files', () => {
    const subs = findSidecarSubtitles('Heat (1995).mkv', dir);
    expect(subs.some((s) => s.filename.includes('Other'))).toBe(false);
    expect(subs.some((s) => s.filename.endsWith('.nfo'))).toBe(false);
  });

  it('is case-insensitive on the extension', () => {
    expect(findSidecarSubtitles('A.mp4', ['A.SRT'])).toEqual([
      { filename: 'A.SRT', format: 'srt' },
    ]);
  });
});

describe('srtToVtt', () => {
  it('adds the WEBVTT header and converts comma timestamps to dots', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,500\nHello\n';
    const vtt = srtToVtt(srt);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.500');
    expect(vtt).toContain('Hello');
  });

  it('normalizes CRLF line endings', () => {
    expect(srtToVtt('1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n')).not.toContain('\r');
  });

  it('passes through text that is already WEBVTT', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
    expect(srtToVtt(vtt)).toBe(vtt);
  });
});

describe('parseSubtitleStreams', () => {
  it('extracts subtitle streams with language/title tags', () => {
    const raw = JSON.stringify({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264' },
        { index: 1, codec_type: 'audio', codec_name: 'aac' },
        { index: 2, codec_type: 'subtitle', tags: { language: 'eng', title: 'English' } },
        { index: 3, codec_type: 'subtitle', tags: { language: 'fre' } },
      ],
    });
    expect(parseSubtitleStreams(raw)).toEqual([
      { index: 2, lang: 'eng', title: 'English' },
      { index: 3, lang: 'fre' },
    ]);
  });

  it('returns [] when there are no subtitle streams', () => {
    expect(parseSubtitleStreams(JSON.stringify({ streams: [] }))).toEqual([]);
  });

  it('excludes bitmap subtitle codecs (cannot be remuxed to WebVTT)', () => {
    const raw = JSON.stringify({
      streams: [
        { index: 2, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
        {
          index: 3,
          codec_type: 'subtitle',
          codec_name: 'hdmv_pgs_subtitle',
          tags: { language: 'fre' },
        },
      ],
    });
    expect(parseSubtitleStreams(raw)).toEqual([{ index: 2, lang: 'eng' }]);
  });
});

describe('buildSubtitleExtractArgs', () => {
  it('maps the stream and outputs webvtt on stdout', () => {
    const args = buildSubtitleExtractArgs('/m/x.mkv', 3);
    expect(args).toContain('-map');
    expect(args[args.indexOf('-map') + 1]).toBe('0:3');
    expect(args).toContain('webvtt');
    expect(args[args.length - 1]).toBe('pipe:1');
  });
});
