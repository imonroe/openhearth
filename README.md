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

## Continuous integration

Every pull request to `dev` (and every push to `dev`) runs
[`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- **build-test** — `pnpm install --frozen-lockfile` (with pnpm cache) →
  Prettier check → lint → typecheck → test → build.
- **docker-build** — builds the production image from `docker/Dockerfile`
  (no push) with GitHub Actions layer caching.

The workflow needs no secrets and makes no outbound calls beyond fetching
dependencies and the base image (NFR-9). Any failing step fails the check.

### Requiring CI before merge (branch protection)

To make these checks mandatory, add a branch-protection rule for `dev`
(Settings → Branches → Add rule) and mark the **`Lint, typecheck, test & build`**
and **`Docker image build`** status checks as required. With protection on, a PR
to `dev` cannot merge until both jobs pass.

See [CLAUDE.md](CLAUDE.md) and [docs/implementation_plan.md](docs/implementation_plan.md)
for architecture and the phased roadmap.
