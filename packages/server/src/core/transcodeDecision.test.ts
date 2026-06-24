import { describe, it, expect } from 'vitest';
import {
  decidePlayback,
  parseRange,
  buildFfmpegArgs,
  containerFromExt,
  containerMime,
  parseProbeJson,
  type ProbeResult,
} from './transcodeDecision.js';

function probe(over: Partial<ProbeResult>): ProbeResult {
  return { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', ...over };
}

describe('decidePlayback', () => {
  it('direct-plays mp4/h264/aac', () => {
    expect(decidePlayback(probe({}))).toBe('direct');
  });
  it('direct-plays webm/vp9/opus', () => {
    expect(decidePlayback({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus' })).toBe(
      'direct',
    );
  });
  it('direct-plays a video-only mp4 (no audio track)', () => {
    expect(decidePlayback(probe({ audioCodec: undefined }))).toBe('direct');
  });
  it('transcodes an unsupported container (mkv) even with h264', () => {
    expect(decidePlayback(probe({ container: 'mkv' }))).toBe('transcode');
  });
  it('transcodes an unsupported video codec (hevc) in mp4', () => {
    expect(decidePlayback(probe({ videoCodec: 'hevc' }))).toBe('transcode');
  });
  it('transcodes an unsupported audio codec (ac3) in mp4', () => {
    expect(decidePlayback(probe({ audioCodec: 'ac3' }))).toBe('transcode');
  });
  it('transcodes mp4 video with a webm-only codec (vp9)', () => {
    expect(decidePlayback(probe({ videoCodec: 'vp9' }))).toBe('transcode');
  });
  it('transcodes when the video codec is unknown', () => {
    expect(decidePlayback(probe({ videoCodec: undefined }))).toBe('transcode');
  });
});

describe('containerFromExt / containerMime', () => {
  it('maps mp4-family extensions to mp4', () => {
    expect(containerFromExt('MP4')).toBe('mp4');
    expect(containerFromExt('m4v')).toBe('mp4');
    expect(containerFromExt('mov')).toBe('mp4');
  });
  it('maps webm and passes others through', () => {
    expect(containerFromExt('webm')).toBe('webm');
    expect(containerFromExt('mkv')).toBe('mkv');
  });
  it('serves the right mime', () => {
    expect(containerMime('webm')).toBe('video/webm');
    expect(containerMime('mp4')).toBe('video/mp4');
  });
});

describe('parseRange', () => {
  const size = 1000;
  it('returns null without a header', () => {
    expect(parseRange(undefined, size)).toBeNull();
  });
  it('parses a closed range', () => {
    expect(parseRange('bytes=0-499', size)).toEqual({ start: 0, end: 499 });
  });
  it('parses an open-ended range (to EOF)', () => {
    expect(parseRange('bytes=500-', size)).toEqual({ start: 500, end: 999 });
  });
  it('clamps an end past EOF', () => {
    expect(parseRange('bytes=900-5000', size)).toEqual({ start: 900, end: 999 });
  });
  it('parses a suffix range (last N bytes)', () => {
    expect(parseRange('bytes=-200', size)).toEqual({ start: 800, end: 999 });
  });
  it('flags an unsatisfiable range past EOF', () => {
    expect(parseRange('bytes=2000-3000', size)).toBe('unsatisfiable');
  });
  it('ignores a malformed/multi-range header (→ full body)', () => {
    expect(parseRange('bytes=0-10,20-30', size)).toBeNull();
    expect(parseRange('items=0-1', size)).toBeNull();
  });
});

describe('parseProbeJson', () => {
  const raw = JSON.stringify({
    streams: [
      { codec_type: 'video', codec_name: 'h264' },
      { codec_type: 'audio', codec_name: 'aac' },
      { codec_type: 'subtitle', codec_name: 'subrip' },
    ],
    format: { duration: '5403.5' },
  });
  it('extracts container (from ext), codecs, and rounded duration', () => {
    expect(parseProbeJson(raw, 'mkv')).toEqual({
      container: 'mkv',
      videoCodec: 'h264',
      audioCodec: 'aac',
      durationSec: 5404,
    });
  });
  it('handles a video-only file with no duration', () => {
    const r = JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'vp9' }], format: {} });
    expect(parseProbeJson(r, 'webm')).toEqual({ container: 'webm', videoCodec: 'vp9' });
  });
});

describe('buildFfmpegArgs', () => {
  it('builds a CPU fMP4 H.264/AAC pipeline by default', () => {
    const args = buildFfmpegArgs('/m/x.mkv');
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe('/m/x.mkv');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args.join(' ')).toContain('frag_keyframe+empty_moov+default_base_moof');
    expect(args[args.length - 1]).toBe('pipe:1');
  });
  it('uses the CPU encoder when hwaccel is explicitly "none" (guaranteed fallback)', () => {
    const args = buildFfmpegArgs('/m/x.mkv', { transcode: { hwaccel: 'none' } });
    expect(args).toContain('libx264');
    expect(args).not.toContain('h264_vaapi');
    expect(args).not.toContain('h264_nvenc');
    expect(args).not.toContain('h264_qsv');
  });
  it('adds a fast input seek before -i', () => {
    const args = buildFfmpegArgs('/m/x.mkv', { seekSec: 90 });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('90');
  });
  it('omits seek for zero/negative offsets', () => {
    expect(buildFfmpegArgs('/m/x.mkv', { seekSec: 0 })).not.toContain('-ss');
  });
  it('uses the VAAPI encoder + device when configured', () => {
    const args = buildFfmpegArgs('/m/x.mkv', {
      transcode: { hwaccel: 'vaapi', device: '/dev/dri/renderD129' },
    });
    expect(args).toContain('h264_vaapi');
    expect(args).toContain('/dev/dri/renderD129');
    expect(args).not.toContain('libx264');
  });
  it('uses NVENC when configured', () => {
    expect(buildFfmpegArgs('/m/x.mkv', { transcode: { hwaccel: 'nvenc' } })).toContain(
      'h264_nvenc',
    );
  });
});
