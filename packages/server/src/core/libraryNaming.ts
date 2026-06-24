/**
 * libraryNaming — pure Movie/TV naming detection (FR-C6).
 *
 * Turns a source-relative media path into a structured guess: movie vs episode,
 * title, year, season/episode, episode title. Intentionally framework- and
 * filesystem-free so it can be unit-tested exhaustively without a DB or disk.
 *
 * The heuristics target the common community conventions:
 *   Movies:   `Heat (1995).mkv`, `Blade.Runner.1982.1080p.mkv`
 *   TV:       `The Office/Season 02/The Office - S02E05 - Halloween.mkv`
 *             `Show.Name.S01E02.mkv`, `Show - 1x03.mkv`, `.../Season 1/E04.mkv`
 *
 * The source's declared `kind` only breaks ties for files with no decisive
 * markers — detection from the name always wins when present.
 *
 * Known limitations (acceptable for v1; richer parsing can land later):
 *   - Multi-episode files (`S01E01E02`) record only the first episode number.
 *   - Anime/absolute-numbering (`Show - 137.mkv`) is not recognized as an
 *     episode and falls through to `other`.
 *   - The `NxNN` convention is greedy: `Show 19x10.mkv` reads as S19E10.
 */
import type { LibraryItemKind } from '@openhearth/shared';

export type SourceKind = 'movies' | 'tv' | 'music' | 'mixed' | undefined;

export interface ParsedMedia {
  kind: LibraryItemKind;
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  episode_title?: string;
}

/** Junk tokens that appear after the meaningful title in scene names. */
const TAG_RE =
  /\b(?:480p|576p|720p|1080p|2160p|4k|uhd|hdr|hevc|x264|x265|h264|h265|av1|aac|ac3|dts|ddp?5\.1|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|hdtv|dvdrip|remux|proper|repack|extended|unrated|directors?\.?cut|imax)\b.*$/i;

const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;
const PAREN_YEAR_RE = /\((19\d{2}|20\d{2})\)/;

// Episode markers, most-specific first. Each captures season + episode.
const SXXEYY_RE = /\bs(\d{1,2})[. _-]?e(\d{1,3})\b/i;
const NxNN_RE = /\b(\d{1,2})x(\d{1,3})\b/i;
// A bare `E05`/`Episode 5` inside a `Season N` folder layout.
const BARE_EP_RE = /\b(?:e|ep|episode)[. _-]?(\d{1,3})\b/i;
const SEASON_FOLDER_RE = /\b(?:season|series|s)[. _-]?(\d{1,2})\b/i;

/** Replace scene separators with spaces and collapse runs. */
function humanize(raw: string): string {
  return raw.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Trim leading/trailing separator punctuation (parens, dashes, dots, spaces). */
function trimEdges(s: string): string {
  return s
    .replace(/^[\s\-_.()]+/, '')
    .replace(/[\s\-_.()]+$/, '')
    .trim();
}

/** Strip a trailing quality/source tag run and surrounding separators. */
function stripTags(name: string): string {
  return trimEdges(humanize(name.replace(TAG_RE, '')));
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, '');
}

/** Parent folder segments (nearest-first), excluding the filename. */
function ancestors(path: string): string[] {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, -1).reverse();
}

/**
 * Find the release year and where the title ends. A parenthesized `(YYYY)` is
 * the strongest signal and wins outright (so `Blade Runner 2049 (2017)` →
 * 2017, not 2049). Otherwise the LAST bare year token wins, since a leading
 * number is usually part of the title (`2001 A Space Odyssey`). `index` is where
 * the title text ends (the `(` for a parenthesized year, else the year start).
 */
function findYear(text: string): { year: number; index: number } | undefined {
  const paren = PAREN_YEAR_RE.exec(text);
  if (paren) return { year: Number(paren[1]), index: paren.index };
  const re = new RegExp(YEAR_RE.source, 'g');
  let last: { year: number; index: number } | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = { year: Number(m[1]), index: m.index };
  return last;
}

/** Title for an episode: text before the marker, else a non-"Season" ancestor. */
function showTitle(beforeMarker: string, path: string): string {
  const fromName = stripTags(beforeMarker);
  if (fromName) return fromName;
  for (const seg of ancestors(path)) {
    if (!SEASON_FOLDER_RE.test(seg)) return stripTags(stripExt(seg));
  }
  return 'Unknown';
}

/** Try to read a season number from the path's folder structure. */
function seasonFromFolders(path: string): number | undefined {
  for (const seg of ancestors(path)) {
    const m = SEASON_FOLDER_RE.exec(seg);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/**
 * Detect movie/episode/other from a source-relative path. `sourceKind` only
 * influences the no-marker fallback.
 */
export function parseMediaPath(relPath: string, sourceKind?: SourceKind): ParsedMedia {
  const file = stripExt(basename(relPath));

  // --- TV episode: explicit SxxEyy / NxNN markers ------------------------------
  for (const re of [SXXEYY_RE, NxNN_RE]) {
    const m = re.exec(file);
    if (m) {
      const before = file.slice(0, m.index);
      const after = file.slice(m.index + m[0].length);
      const epTitle = stripTags(after);
      return {
        kind: 'episode',
        title: showTitle(before, relPath),
        season: Number(m[1]),
        episode: Number(m[2]),
        ...(epTitle ? { episode_title: epTitle } : {}),
      };
    }
  }

  // --- TV episode: a bare E05/Episode 5 inside a Season folder -----------------
  const season = seasonFromFolders(relPath);
  if (season !== undefined) {
    const bare = BARE_EP_RE.exec(file);
    if (bare) {
      const before = file.slice(0, bare.index);
      const after = file.slice(bare.index + bare[0].length);
      const epTitle = stripTags(after);
      return {
        kind: 'episode',
        title: showTitle(before, relPath),
        season,
        episode: Number(bare[1]),
        ...(epTitle ? { episode_title: epTitle } : {}),
      };
    }
  }

  // --- Movie: a year in the name or a parent folder (or a movies-kind source) --
  // Title is parsed from whichever string carries the year (`Movie (Year)/file`
  // layouts put the year on the folder, not the file).
  let found = sourceKind !== 'music' ? findYear(file) : undefined;
  let titleSource = file;
  if (!found && sourceKind !== 'music') {
    for (const seg of ancestors(relPath)) {
      const y = findYear(seg);
      if (y) {
        found = y;
        titleSource = seg;
        break;
      }
    }
  }
  const year = found?.year;
  const looksLikeMovie = year !== undefined || sourceKind === 'movies';
  if (looksLikeMovie && sourceKind !== 'music') {
    const beforeYear = found ? titleSource.slice(0, found.index) : titleSource;
    const title = stripTags(beforeYear) || stripTags(file) || 'Unknown';
    return { kind: 'movie', title, ...(year !== undefined ? { year } : {}) };
  }

  // --- Fallback: unrecognized / music ------------------------------------------
  return { kind: 'other', title: stripTags(file) || basename(relPath) };
}
