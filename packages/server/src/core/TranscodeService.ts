/**
 * TranscodeService — ffprobe the source and, when the browser can't direct-play
 * it, spawn ffmpeg to transcode to fragmented MP4 (H.264/AAC) on stdout
 * (FR-C3/FR-C4; PRD §12). The decision rules, range parsing, and ffmpeg argument
 * construction live in transcodeDecision.ts (pure, fully unit-tested); this
 * class is the thin process layer.
 *
 * The route depends on the {@link MediaStreamer} interface, so tests can inject
 * a fake without ffmpeg installed. ffmpeg/ffprobe live in the runtime image.
 */
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import type { TranscodeConfig } from '@openhearth/shared';
import { buildFfmpegArgs, parseProbeJson, type ProbeResult } from './transcodeDecision.js';

export interface TranscodeStream {
  /** ffmpeg stdout (fragmented MP4). */
  stream: Readable;
  /** Terminate the ffmpeg process (call on client disconnect / error). */
  kill: () => void;
}

/** The streaming surface the route needs; implemented by TranscodeService. */
export interface MediaStreamer {
  probe(path: string): Promise<ProbeResult>;
  openTranscode(path: string, opts?: { seekSec?: number }): TranscodeStream;
}

type SpawnFn = typeof nodeSpawn;

export interface TranscodeServiceOptions {
  ffprobePath?: string;
  ffmpegPath?: string;
  transcode?: TranscodeConfig;
  /** Injectable for tests (defaults to child_process.spawn). */
  spawn?: SpawnFn;
}

export class TranscodeService implements MediaStreamer {
  private readonly ffprobePath: string;
  private readonly ffmpegPath: string;
  private readonly transcode?: TranscodeConfig;
  private readonly spawn: SpawnFn;

  constructor(opts: TranscodeServiceOptions = {}) {
    this.ffprobePath = opts.ffprobePath ?? 'ffprobe';
    this.ffmpegPath = opts.ffmpegPath ?? 'ffmpeg';
    this.transcode = opts.transcode;
    this.spawn = opts.spawn ?? nodeSpawn;
  }

  /** Run ffprobe and return the normalized probe result. */
  probe(path: string): Promise<ProbeResult> {
    const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path];
    return new Promise((resolve, reject) => {
      const child = this.spawn(this.ffprobePath, args) as ChildProcessWithoutNullStreams;
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe exited ${code}: ${err.trim()}`));
          return;
        }
        try {
          resolve(parseProbeJson(out, extname(path).slice(1)));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
  }

  /** Spawn ffmpeg and expose its stdout stream plus a kill handle. */
  openTranscode(path: string, opts: { seekSec?: number } = {}): TranscodeStream {
    const args = buildFfmpegArgs(path, {
      ...(opts.seekSec != null ? { seekSec: opts.seekSec } : {}),
      ...(this.transcode ? { transcode: this.transcode } : {}),
    });
    const child = this.spawn(this.ffmpegPath, args) as ChildProcessWithoutNullStreams;
    // Drain stderr so the pipe buffer can't fill and stall ffmpeg.
    child.stderr.on('data', () => {});
    return {
      stream: child.stdout,
      kill: () => {
        if (!child.killed) child.kill('SIGKILL');
      },
    };
  }
}
