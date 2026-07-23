/**
 * SlideshowService — resolves the slideshow's image set (#164).
 *
 * The set is the union of two sources: photos uploaded through the UI (stored
 * under `config/slideshow/uploads/`, user data that survives a cache wipe) and
 * host-mapped folders declared in `ui.slideshow.sources[]`. Each image gets a
 * stable, opaque id (sha1 of source + relative path) so the client never sees or
 * controls a filesystem path — it requests `GET /api/v1/slideshow/image/:id` and
 * the server maps the id back to a path, served through the same path-contained
 * defense-in-depth used for icons/wallpaper.
 *
 * Nothing here is cached in SQLite: the set is filesystem-derived and disposable,
 * recomputed on demand (photo frames hold at most a few thousand stills, and a
 * serve happens roughly once per interval). No image processing — originals are
 * served and the browser sizes them with CSS `object-fit`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  SLIDESHOW_DEFAULT_INTERVAL_SECONDS,
  SLIDESHOW_DEFAULT_ORDER,
  SLIDESHOW_DEFAULT_TRANSITION,
  type SlideshowConfig,
  type SlideshowManifest,
  type SlideshowManifestImage,
} from '@openhearth/shared';

/** Recognized raster image extensions (lower-case, no dot). No SVG (XSS). */
export const SLIDESHOW_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

/** Subdirectory (under the config dir) holding UI-uploaded photos. */
export const SLIDESHOW_UPLOADS_DIR = path.join('slideshow', 'uploads');

/** Reserved source id for uploaded photos (kept distinct from user source ids). */
const UPLOADS_SOURCE_ID = '\0uploads';

/** Upper bound on images in one manifest; excess is dropped with a warning. */
export const SLIDESHOW_MAX_IMAGES = 5000;

/** One resolved image: its opaque id and how to serve it (base dir + rel path). */
interface ResolvedImage {
  id: string;
  uploaded: boolean;
  /** Trusted base directory the served file must stay within. */
  baseDir: string;
  /** Path of the file relative to `baseDir`. */
  relPath: string;
}

export interface SlideshowServiceOptions {
  /** Absolute path of the config dir (uploads live under it). */
  configDir: string;
  /** Reads the current slideshow config (from ConfigService) at resolve time. */
  getConfig: () => SlideshowConfig | undefined;
  /** Optional warning sink (e.g. request.log.warn) for truncation notices. */
  onWarn?: (message: string) => void;
}

/** Resolved slideshow playback settings with defaults applied. */
export function resolveSlideshowSettings(
  config: SlideshowConfig | undefined,
): SlideshowManifest['settings'] {
  return {
    intervalSeconds: config?.intervalSeconds ?? SLIDESHOW_DEFAULT_INTERVAL_SECONDS,
    transition: config?.transition ?? SLIDESHOW_DEFAULT_TRANSITION,
    order: config?.order ?? SLIDESHOW_DEFAULT_ORDER,
  };
}

export class SlideshowService {
  private readonly configDir: string;
  private readonly getConfig: () => SlideshowConfig | undefined;
  private readonly onWarn?: (message: string) => void;

  constructor(opts: SlideshowServiceOptions) {
    this.configDir = opts.configDir;
    this.getConfig = opts.getConfig;
    this.onWarn = opts.onWarn;
  }

  /** The resolved manifest: ordered image ids + playback settings. */
  manifest(): SlideshowManifest {
    const images: SlideshowManifestImage[] = this.collect().map((e) => ({
      id: e.id,
      uploaded: e.uploaded,
    }));
    return { images, settings: resolveSlideshowSettings(this.getConfig()) };
  }

  /**
   * Map an image id back to a servable `{ baseDir, relPath }`, or undefined if
   * no current image has that id. The caller serves it through the shared
   * path-containment helper, so a stale/forged id can never escape a base dir.
   */
  resolveImage(id: string): { baseDir: string; relPath: string } | undefined {
    const found = this.collect().find((e) => e.id === id);
    return found ? { baseDir: found.baseDir, relPath: found.relPath } : undefined;
  }

  /** Absolute path of the uploads directory (created lazily by the upload route). */
  uploadsDir(): string {
    return path.join(this.configDir, SLIDESHOW_UPLOADS_DIR);
  }

  /** True when `id` refers to an uploaded (deletable) photo in the current set. */
  isUploaded(id: string): boolean {
    return this.collect().some((e) => e.id === id && e.uploaded);
  }

  /** Build the ordered, deterministic list of resolved images. */
  private collect(): ResolvedImage[] {
    const config = this.getConfig();
    const out: ResolvedImage[] = [];

    // Folder sources first (declared order), each sorted lexically for stability.
    for (const source of config?.sources ?? []) {
      const files = this.scanFolder(source.path, source.recursive ?? false);
      for (const rel of files) {
        out.push({
          id: imageId(source.id, rel),
          uploaded: false,
          baseDir: source.path,
          relPath: rel,
        });
      }
    }

    // Uploaded photos last, sorted by name.
    for (const name of this.listUploads()) {
      out.push({
        id: imageId(UPLOADS_SOURCE_ID, name),
        uploaded: true,
        baseDir: this.uploadsDir(),
        relPath: name,
      });
    }

    if (out.length > SLIDESHOW_MAX_IMAGES) {
      this.onWarn?.(
        `slideshow: ${out.length} images found; showing the first ${SLIDESHOW_MAX_IMAGES}`,
      );
      return out.slice(0, SLIDESHOW_MAX_IMAGES);
    }
    return out;
  }

  /** Names of image files directly in the uploads dir (sorted; [] if absent). */
  private listUploads(): string[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.uploadsDir(), { withFileTypes: true });
    } catch {
      return []; // no uploads yet — not an error
    }
    return entries
      .filter((e) => e.isFile() && isImageName(e.name))
      .map((e) => e.name)
      .sort();
  }

  /**
   * Source-relative paths of image files under `root`. `recursive` descends into
   * subfolders. Symlinks whose real path escapes `root` are skipped (defense in
   * depth; the serve route re-checks containment anyway). Sorted for stability.
   * An unreadable root yields [] with a warning rather than throwing.
   */
  private scanFolder(root: string, recursive: boolean): string[] {
    let rootReal: string;
    try {
      rootReal = fs.realpathSync(path.resolve(root));
    } catch {
      this.onWarn?.(`slideshow: source folder not accessible: ${root}`);
      return [];
    }

    const out: string[] = [];
    const visited = new Set<string>();
    const stack: string[] = [rootReal];
    while (stack.length) {
      const dir = stack.pop()!;
      let real: string;
      try {
        real = fs.realpathSync(dir);
      } catch {
        continue;
      }
      if (visited.has(real)) continue;
      visited.add(real);
      // Stay within the source root even across symlinked directories.
      if (real !== rootReal && !real.startsWith(rootReal + path.sep)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // hidden / sidecar files
        const abs = path.join(dir, entry.name);
        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        let realAbs = abs;
        if (entry.isSymbolicLink()) {
          try {
            realAbs = fs.realpathSync(abs);
            const st = fs.statSync(realAbs);
            isDir = st.isDirectory();
            isFile = st.isFile();
          } catch {
            continue; // dangling symlink
          }
          // Skip anything that escapes the source root.
          if (realAbs !== rootReal && !realAbs.startsWith(rootReal + path.sep)) continue;
        }
        if (isDir) {
          if (recursive) stack.push(abs);
        } else if (isFile && isImageName(entry.name)) {
          out.push(path.relative(rootReal, abs));
        }
      }
    }
    return out.sort();
  }
}

/** True when a filename has a recognized raster image extension. */
export function isImageName(name: string): boolean {
  return SLIDESHOW_IMAGE_EXTENSIONS.has(path.extname(name).slice(1).toLowerCase());
}

/** Stable opaque id for an image: a hash of source id + source-relative path. */
export function imageId(sourceId: string, relPath: string): string {
  return createHash('sha1').update(`${sourceId}\0${relPath}`).digest('hex');
}
