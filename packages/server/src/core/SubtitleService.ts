/**
 * SubtitleService — assemble an item's selectable subtitle tracks from sidecar
 * files (`Movie.en.srt`) and embedded streams, and serve any of them as WebVTT
 * (FR-C7). Sidecars are read from disk and SRT-converted in-process; embedded
 * tracks are extracted by ffmpeg via the {@link MediaStreamer}.
 *
 * Tracks get stable, position-based ids so the serve route can re-derive the
 * same list and pick a track without server-side session state.
 */
import * as fs from 'node:fs';
import { dirname, join, basename } from 'node:path';
import type { SubtitleTrack } from '@openhearth/shared';
import { findSidecarSubtitles, srtToVtt } from './subtitles.js';
import type { MediaStreamer, TranscodeStream } from './TranscodeService.js';

interface Descriptor extends SubtitleTrack {
  sidecarFile?: string;
  embeddedIndex?: number;
}

/** A served track: either ready VTT text (sidecar) or a stream (embedded). */
export type OpenedSubtitle = { text: string } | { stream: TranscodeStream };

function label(lang: string | undefined, fallback: string): string {
  return lang ? `Subtitles (${lang})` : fallback;
}

export class SubtitleService {
  constructor(private readonly streamer: MediaStreamer) {}

  /** Describe all subtitle tracks for a media file (sidecars first, then embedded). */
  async describe(mediaPath: string): Promise<Descriptor[]> {
    let dirFiles: string[] = [];
    try {
      dirFiles = fs.readdirSync(dirname(mediaPath));
    } catch {
      dirFiles = [];
    }
    const sidecars = findSidecarSubtitles(basename(mediaPath), dirFiles);
    const embedded = this.streamer.probeSubtitles
      ? await this.streamer.probeSubtitles(mediaPath).catch(() => [])
      : [];

    const out: Descriptor[] = [];
    let i = 0;
    for (const s of sidecars) {
      out.push({
        id: String(i++),
        label: label(s.lang, 'Subtitles'),
        lang: s.lang ?? null,
        source: 'sidecar',
        sidecarFile: s.filename,
      });
    }
    for (const e of embedded) {
      out.push({
        id: String(i++),
        label: e.title ?? label(e.lang, `Track ${e.index}`),
        lang: e.lang ?? null,
        source: 'embedded',
        embeddedIndex: e.index,
      });
    }
    return out;
  }

  /** Public track list (without internal source pointers). */
  async list(mediaPath: string): Promise<SubtitleTrack[]> {
    return (await this.describe(mediaPath)).map(
      ({ id, label: l, lang, source }): SubtitleTrack => ({ id, label: l, lang, source }),
    );
  }

  /** Open one track by id as WebVTT, or null if the id is unknown/unavailable. */
  async open(mediaPath: string, id: string): Promise<OpenedSubtitle | null> {
    const track = (await this.describe(mediaPath)).find((t) => t.id === id);
    if (!track) return null;

    if (track.source === 'sidecar' && track.sidecarFile) {
      try {
        const raw = fs.readFileSync(join(dirname(mediaPath), track.sidecarFile), 'utf8');
        return { text: srtToVtt(raw) }; // idempotent for files already in VTT
      } catch {
        return null;
      }
    }
    if (
      track.source === 'embedded' &&
      track.embeddedIndex != null &&
      this.streamer.openSubtitleExtract
    ) {
      return { stream: this.streamer.openSubtitleExtract(mediaPath, track.embeddedIndex) };
    }
    return null;
  }
}
