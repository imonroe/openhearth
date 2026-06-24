/**
 * AuthGuard — optional shared-token auth for the API/WS (#47; PRD §17).
 *
 * Off by default: with no `server.auth.token` configured the guard is disabled
 * and every request is allowed (trusted-LAN default, non-breaking). When a token
 * is set, a caller is authorized iff it presents the exact token via any of:
 *   - the `Authorization: Bearer <token>` header (REST), or
 *   - a `?token=<token>` query param (WS handshake, or REST clients that can't set
 *     headers), or
 *   - the protocol `auth` field on a control command (the reserved envelope field).
 *
 * Comparison is constant-time to avoid leaking the token via timing.
 */
import { timingSafeEqual } from 'node:crypto';

export class AuthGuard {
  private readonly token: string | undefined;
  private readonly tokenBuf: Buffer | undefined;

  constructor(token: string | undefined) {
    // An empty/whitespace token is treated as "no auth" — a blank config value
    // must never silently lock everyone out *or* accept the empty string.
    const trimmed = token?.trim();
    if (trimmed) {
      this.token = trimmed;
      this.tokenBuf = Buffer.from(trimmed);
    }
  }

  /** True when a token is configured (auth is enforced). */
  get enabled(): boolean {
    return this.token !== undefined;
  }

  /** Constant-time check of a presented token against the configured one. */
  accepts(provided: string | undefined | null): boolean {
    if (!this.enabled) return true; // disabled → everything allowed
    if (typeof provided !== 'string' || provided.length === 0) return false;
    const a = Buffer.from(provided);
    const b = this.tokenBuf as Buffer;
    // timingSafeEqual requires equal lengths; the length check itself is not
    // secret (token length isn't sensitive) and avoids a throw.
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

/**
 * Extract a presented token from a REST request: the `Authorization: Bearer`
 * header first, then a `?token=` query param. Returns undefined when neither is
 * present. Header/query values may be arrays (duplicated) — take the first.
 */
export function tokenFromRequest(req: {
  headers: Record<string, string | string[] | undefined>;
  query?: unknown;
}): string | undefined {
  const auth = first(req.headers['authorization']);
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1];
  }
  const q = req.query;
  if (q && typeof q === 'object' && 'token' in q) {
    return first((q as Record<string, unknown>).token);
  }
  return undefined;
}

function first(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Redact the `token` query value from a URL string for logging, so the shared
 * token never lands in the request log (clients that can't set headers — e.g. the
 * WS handshake — pass it as a query param). Parses the query so it's decode-aware:
 * a percent-encoded param name (`%74oken=…`, which the query parser still reads as
 * `token`) is redacted too, closing that bypass. Non-token params are preserved.
 */
export function redactTokenInUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  if (!params.has('token')) return url;
  params.set('token', '***');
  return `${url.slice(0, q)}?${params.toString()}`;
}
