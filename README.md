# OpenHearth

A Docker-based, open-source streaming hub with a TV-optimized interface and remote-mappable keyboard controls.

## Monorepo layout

OpenHearth is a pnpm workspace with three packages connected by TypeScript
project references:

```
packages/
  shared/   @openhearth/shared — the seam contract (types + schemas). Imports nothing else.
  server/   @openhearth/server — the "brain" (Fastify API, WS control, streaming). Imports shared.
  web/      @openhearth/web    — the "face" (React SPA in a kiosk). Imports shared.
```

### The seam rule

`web` never imports from `server`, and `server` never imports from `web`. Both
import only from `shared`. This is enforced two ways:

- **TypeScript project references** — neither `server` nor `web` references the
  other, so a cross-import fails to resolve.
- **ESLint** — `no-restricted-imports` patterns in `eslint.config.js` reject the
  import with an explicit "Seam violation" message.

## Development

Requires Node 20+ and pnpm.

```sh
pnpm install      # install all workspace dependencies
pnpm build        # build all packages via project references
pnpm typecheck    # type-check everything
pnpm lint         # ESLint across the workspace (incl. seam boundary check)
pnpm format       # Prettier write
pnpm test         # run package tests
pnpm dev          # watch-build all packages
```

See [CLAUDE.md](CLAUDE.md) and [docs/implementation_plan.md](docs/implementation_plan.md)
for architecture and the phased roadmap.
