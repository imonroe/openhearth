/**
 * CatalogService — turn declarative service YAML into the tile model.
 *
 * Reads the raw `services.yaml` + `services.d/*.yaml` data loaded by
 * ConfigService and produces the ordered, grouped {@link ServiceCatalog}.
 * Validation is per-entry: a malformed tile is reported as an error and skipped,
 * never dropping the rest of the catalog (FR-A1/FR-A4).
 *
 * Drop-in `services.d/*` files merge on top of `services.yaml`; a later
 * definition with the same `id` overrides an earlier one (community override).
 * The catalog is computed on demand from ConfigService's current snapshot, so it
 * always reflects the latest hot-reloaded config.
 */
import {
  serviceSchema,
  serviceFileSchema,
  DEFAULT_SERVICE_GROUP,
  type ServiceTile,
  type ServiceCatalog,
  type ServiceGroup,
} from '@openhearth/shared';
import type { ConfigService, RawServiceCatalog } from './ConfigService.js';

export class CatalogService {
  constructor(private readonly config: ConfigService) {}

  /** Build the ordered, grouped catalog from the current raw services data. */
  getCatalog(): ServiceCatalog {
    return buildCatalog(this.config.services);
  }
}

/** Parse + merge + order + group raw services data into a catalog. */
export function buildCatalog(raw: RawServiceCatalog): ServiceCatalog {
  const errors: string[] = [];
  // Insertion order preserves first-seen ordering; `id` keys dedupe (last wins).
  const byId = new Map<string, ServiceTile>();

  // `services.yaml` first, then each `services.d/*` in filename order.
  const sources: Array<{ label: string; data: unknown }> = [
    { label: 'services.yaml', data: raw.base },
    ...Object.keys(raw.overlays)
      .sort()
      .map((file) => ({ label: `services.d/${file}`, data: raw.overlays[file] })),
  ];

  for (const { label, data } of sources) {
    if (data === undefined || data === null) continue;

    const file = serviceFileSchema.safeParse(data);
    if (!file.success) {
      errors.push(`${label}: ${file.error.issues.map((i) => i.message).join('; ')}`);
      continue;
    }

    const entries = file.data.services ?? [];
    const idsInThisFile = new Set<string>();
    entries.forEach((entry, index) => {
      const parsed = serviceSchema.safeParse(entry);
      if (!parsed.success) {
        const where = `${label}[${index}]`;
        for (const issue of parsed.error.issues) {
          const path = issue.path.length ? issue.path.join('.') : '(entry)';
          errors.push(`${where}.${path}: ${issue.message}`);
        }
        return; // skip this entry, keep the rest of the catalog
      }
      // A duplicate id *within the same file* is almost always a typo (unlike a
      // cross-file override, which is the intended community-catalog feature) —
      // surface it as a non-fatal warning. Last-wins either way.
      if (idsInThisFile.has(parsed.data.id)) {
        errors.push(
          `${label}[${index}]: duplicate id "${parsed.data.id}" in the same file (last wins)`,
        );
      }
      idsInThisFile.add(parsed.data.id);
      byId.set(parsed.data.id, parsed.data);
    });
  }

  return { groups: groupAndOrder([...byId.values()]), errors };
}

/** Group tiles by `group` (insertion order), sorted within a group. */
function groupAndOrder(tiles: ServiceTile[]): ServiceGroup[] {
  const groups = new Map<string, ServiceTile[]>();
  for (const tile of tiles) {
    const key = tile.group ?? DEFAULT_SERVICE_GROUP;
    const bucket = groups.get(key);
    if (bucket) bucket.push(tile);
    else groups.set(key, [tile]);
  }

  return [...groups.entries()].map(([group, services]) => ({
    group,
    services: services.slice().sort(compareTiles),
  }));
}

/** Order by `order` ascending (missing last), then by name. */
function compareTiles(a: ServiceTile, b: ServiceTile): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  // Pin the locale so ordering is deterministic across hosts.
  return a.name.localeCompare(b.name, 'en');
}
