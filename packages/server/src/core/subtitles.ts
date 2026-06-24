/**
 * subtitles — pure helpers for sidecar discovery and SRT→VTT conversion
 * (FR-C7). No filesystem or process access here, so they unit-test without
 * fixtures; the service layer wires these to disk + ffmpeg.
 */

export interface SidecarMatch {
  /** The sidecar file name (in the media file's directory). */
  filename: string;
  /** `srt` or `vtt` (from the extension). */
  format: 'srt' | 'vtt';
  /** Language tag parsed from a `name.<lang>.srt` suffix, if present. */
  lang?: string;
}

const SUB_EXT = /\.(srt|vtt)$/i;

export interface EmbeddedSubtitle {
  /** ffprobe stream index. */
  index: number;
  lang?: string;
  title?: string;
}

interface FfprobeSubJson {
  streams?: Array<{
    index?: number;
    codec_type?: string;
    tags?: { language?: string; title?: string };
  }>;
}

/** Parse embedded subtitle streams from `ffprobe -print_format json` output. */
export function parseSubtitleStreams(raw: string): EmbeddedSubtitle[] {
  const json = JSON.parse(raw) as FfprobeSubJson;
  const out: EmbeddedSubtitle[] = [];
  for (const s of json.streams ?? []) {
    if (s.codec_type !== 'subtitle' || typeof s.index !== 'number') continue;
    out.push({
      index: s.index,
      ...(s.tags?.language ? { lang: s.tags.language } : {}),
      ...(s.tags?.title ? { title: s.tags.title } : {}),
    });
  }
  return out;
}

/** ffmpeg args to extract one embedded subtitle stream as WebVTT on stdout. */
export function buildSubtitleExtractArgs(inputPath: string, streamIndex: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-map',
    `0:${streamIndex}`,
    '-f',
    'webvtt',
    'pipe:1',
  ];
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/**
 * Find subtitle sidecars for `mediaFilename` among `dirFilenames` (same folder).
 * Matches `Movie.srt`, `Movie.vtt`, and language-suffixed `Movie.en.srt` /
 * `Movie.en.forced.vtt` (the suffix between the media base and the extension is
 * reported verbatim as `lang`). Case-insensitive on extension; deterministic
 * order (sorted by filename).
 */
export function findSidecarSubtitles(
  mediaFilename: string,
  dirFilenames: readonly string[],
): SidecarMatch[] {
  const base = stripExt(mediaFilename);
  const out: SidecarMatch[] = [];
  for (const f of dirFilenames) {
    const extMatch = SUB_EXT.exec(f);
    if (!extMatch) continue;
    const name = stripExt(f);
    if (name === base) {
      out.push({ filename: f, format: extMatch[1]!.toLowerCase() as 'srt' | 'vtt' });
    } else if (name.startsWith(`${base}.`)) {
      const lang = name.slice(base.length + 1);
      out.push({
        filename: f,
        format: extMatch[1]!.toLowerCase() as 'srt' | 'vtt',
        ...(lang ? { lang } : {}),
      });
    }
  }
  return out.sort((a, b) => a.filename.localeCompare(b.filename, 'en'));
}

/**
 * Convert SubRip (.srt) text to WebVTT. The essential differences: a `WEBVTT`
 * header and `,`→`.` in cue timestamps. SRT cue-number lines are valid VTT cue
 * identifiers, so they're left in place. Idempotent-ish: already-VTT input gets
 * a header only if missing.
 */
export function srtToVtt(srt: string): string {
  const normalized = srt.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  if (/^\s*WEBVTT/.test(normalized)) return normalized;
  const body = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    (_m, hms: string, ms: string) => `${hms}.${ms}`,
  );
  return `WEBVTT\n\n${body.replace(/^\n+/, '')}`;
}
