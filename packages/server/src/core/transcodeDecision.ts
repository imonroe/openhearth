/**
 * transcodeDecision — pure playback-decision + helpers for the stream endpoint
 * (FR-C3/FR-C4; PRD §12.1). No child processes, no filesystem: just the rules
 * for "can the browser direct-play this?" plus HTTP range parsing and ffmpeg
 * argument construction, so they can be unit-tested without ffmpeg installed.
 */
import type { TranscodeConfig } from '@openhearth/shared';

export interface ProbeResult {
  /** Normalized container hint (lower-case, e.g. `mp4`, `webm`, `mkv`). */
  container: string;
  /** First video stream codec (ffprobe `codec_name`), if any. */
  videoCodec?: string;
  /** First audio stream codec, if any. */
  audioCodec?: string;
  /** Duration in seconds, if known. */
  durationSec?: number;
}

export type PlaybackMode = 'direct' | 'transcode';

/** Shape of the `ffprobe -print_format json` output we care about. */
interface FfprobeJson {
  streams?: Array<{ codec_type?: string; codec_name?: string }>;
  format?: { duration?: string | number };
}

/**
 * Turn `ffprobe -show_format -show_streams -print_format json` output plus the
 * file extension into a {@link ProbeResult}. Container comes from the extension
 * (reliable for the play decision); codecs + duration come from ffprobe. Pure so
 * it can be tested without ffprobe installed.
 */
export function parseProbeJson(raw: string, ext: string): ProbeResult {
  const json = JSON.parse(raw) as FfprobeJson;
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const dur = Number(json.format?.duration);
  return {
    container: containerFromExt(ext),
    ...(video?.codec_name ? { videoCodec: video.codec_name } : {}),
    ...(audio?.codec_name ? { audioCodec: audio.codec_name } : {}),
    ...(Number.isFinite(dur) && dur > 0 ? { durationSec: Math.round(dur) } : {}),
  };
}

/** Containers a browser `<video>` can play from directly. */
const DIRECT_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm']);
// Conservative codec sets: AV1 is deliberately excluded (decode support is
// unreliable on the mini-PC / TV-box hardware OpenHearth targets), so AV1
// transcodes to H.264 rather than risking a black screen with no fallback.
/** Codecs that play directly inside an MP4-family container. */
const MP4_VIDEO = new Set(['h264', 'avc1']);
const MP4_AUDIO = new Set(['aac', 'mp3', 'mp4a']);
/** Codecs that play directly inside a WebM container. */
const WEBM_VIDEO = new Set(['vp8', 'vp9']);
const WEBM_AUDIO = new Set(['opus', 'vorbis']);

/** MIME type to serve for a direct-played container. */
export function containerMime(container: string): string {
  return container === 'webm' ? 'video/webm' : 'video/mp4';
}

/** Normalize a file extension (no dot) to a container family key. */
export function containerFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'mp4' || e === 'm4v' || e === 'mov') return 'mp4';
  if (e === 'webm') return 'webm';
  return e;
}

/**
 * Decide direct-play vs transcode. The container must be browser-playable AND
 * its video/audio codecs supported for that container. A missing audio track is
 * fine; an unknown/absent video codec forces a transcode (we can't assume).
 */
export function decidePlayback(probe: ProbeResult): PlaybackMode {
  const c = probe.container;
  if (!DIRECT_CONTAINERS.has(c)) return 'transcode';
  const family = c === 'webm' ? 'webm' : 'mp4';
  const video = family === 'webm' ? WEBM_VIDEO : MP4_VIDEO;
  const audio = family === 'webm' ? WEBM_AUDIO : MP4_AUDIO;

  if (!probe.videoCodec || !video.has(probe.videoCodec.toLowerCase())) return 'transcode';
  if (probe.audioCodec && !audio.has(probe.audioCodec.toLowerCase())) return 'transcode';
  return 'direct';
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single HTTP `Range: bytes=start-end` header against a known size.
 * Returns the resolved inclusive range, `null` when there's no range header,
 * or `'unsatisfiable'` for a syntactically valid but out-of-bounds range (→ 416).
 * Only a single range is supported (multipart ranges are not).
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // ignore unsupported/multi-range forms → full body
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/**
 * Build ffmpeg arguments to transcode `inputPath` to fragmented MP4 (H.264/AAC)
 * on stdout. `seekSec` does a fast input seek (before `-i`) so the player can
 * jump into a transcode without re-encoding from the start. `hwaccel` selects an
 * optional GPU encoder; the default is the guaranteed CPU path (libx264).
 */
export function buildFfmpegArgs(
  inputPath: string,
  opts: { seekSec?: number; transcode?: TranscodeConfig } = {},
): string[] {
  const args: string[] = ['-hide_banner', '-loglevel', 'error'];
  const hw = opts.transcode?.hwaccel ?? 'none';

  // Fast input seek (keyframe-accurate enough for resume/scrubbing).
  if (opts.seekSec && opts.seekSec > 0) {
    args.push('-ss', String(opts.seekSec));
  }

  // Hardware-accelerated decode/encode setup (opt-in).
  if (hw === 'vaapi') {
    const device = opts.transcode?.device ?? '/dev/dri/renderD128';
    args.push('-hwaccel', 'vaapi', '-vaapi_device', device);
  }

  args.push('-i', inputPath);

  // Video encoder per backend; CPU libx264 is the default and the fallback.
  switch (hw) {
    case 'vaapi':
      args.push('-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi');
      break;
    case 'nvenc':
      args.push('-c:v', 'h264_nvenc', '-preset', 'p4');
      break;
    case 'qsv':
      args.push('-c:v', 'h264_qsv');
      break;
    default:
      args.push('-c:v', 'libx264', '-preset', 'veryfast');
  }

  args.push(
    '-c:a',
    'aac',
    '-ac',
    '2',
    // Fragmented MP4 so playback can start before the whole file is encoded.
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  );
  return args;
}
