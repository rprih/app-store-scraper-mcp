# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

`app-store-scraper-mcp` is an MCP server (stdio transport) that exposes the
[`app-store-scraper`](https://github.com/facundoolano/app-store-scraper) npm package as MCP tools.
It is published to npm and run by clients via `npx -y app-store-scraper-mcp`.

- `src/index.ts` — server entry point (has a `#!` shebang; it is the `bin`). Registers all tools with
  `server.registerTool(...)`, using `zod` schemas for inputs and outputs. Holds the shared helpers: in-memory
  5-minute cache, `ok`/`fail` result wrappers, `safe()` error wrapper, `compact()`/`compactList()`
  for trimming list responses, and `fixRatings()`. The server version reported to MCP clients is read
  from `package.json` at runtime, so never hardcode it.
- `src/schemas.ts` — shared `zod` input parameter schemas and structured `outputSchema` definitions for all tools.
- `src/app-page.ts` — fetches an apps.apple.com product page (cached 5 minutes) and extracts its
  embedded `serialized-server-data` JSON, plus tree-walking helpers. Shared by the page parsers below.
- `src/versions.ts` — version history (`get_app_versions`), read from the page's Version History section.
- `src/privacy.ts` — replacement for upstream `privacy()`, which broke after Apple's apps.apple.com
  redesign. Parses the page's embedded `serialized-server-data` JSON and keeps the upstream output shape.
- `src/app-store-scraper.d.ts` — hand-written types for the untyped upstream package. Update it when
  calling a new upstream method or constant.
- `dist/` — build output, gitignored, and the only thing shipped to npm (`"files": ["dist"]`).

## Commands

```bash
npm ci            # install
npm run build     # tsc -> dist/
npm run dev       # tsc --watch
npm run inspect   # MCP Inspector against dist/index.js
npm pack --dry-run  # check what would be published
```

There is no test suite or linter; `npm run build` (strict TypeScript) is the only check, and CI runs it.

## Conventions

- ESM (`"type": "module"`, `module: Node16`): relative imports must use the `.js` extension
  (`import { privacy } from "./privacy.js"`).
- Node >= 18 at runtime. The toolchain is TypeScript 7 (`tsc`).
- List-style tools return compact objects by default; full objects only with `verbose: true`.
  Keep responses small — they land in a model's context.
- Workarounds for upstream bugs live in this repo (see "Fixes over upstream" in `README.md`).
  When adding one, document it there too.
- When adding or changing a tool, update the Tools table in `README.md`.

## Commits and releases

Releases are fully automated with [release-please](https://github.com/googleapis/release-please).
**Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/)** — they
drive the version bump and `CHANGELOG.md`.

| Type | Effect (while version < 1.0) | In changelog |
| --- | --- | --- |
| `feat:` | minor bump | Features |
| `fix:` | patch bump | Bug Fixes |
| `perf:`, `deps:`, `revert:` | patch bump | yes |
| `feat!:` / `BREAKING CHANGE:` footer | minor bump (`bump-minor-pre-major`) | yes |
| `docs:`, `chore:`, `refactor:`, `test:`, `build:`, `ci:` | no release | hidden |

To force a specific version, add a `Release-As: x.y.z` footer to a commit.

Flow (`.github/workflows/release-please.yml`):

1. Every push to `main` runs release-please, which opens/updates a release PR
   (`chore(main): release x.y.z`) that bumps `package.json`, `.release-please-manifest.json`
   and `CHANGELOG.md`.
2. Merging that PR creates the `vX.Y.Z` tag and GitHub Release.
3. The `publish` job then checks out the tag, builds, and runs `npm publish --provenance --access public`.

npm auth uses **Trusted Publishing (OIDC)** — there is no npm token or `NPM_TOKEN` secret. The
trusted publisher on npmjs.com is bound to repo `rprih/app-store-scraper-mcp` and workflow file
`release-please.yml`; renaming that file, or adding a GitHub environment to the job, breaks publishing
until the npm setting is updated. The job needs `permissions: id-token: write`.

Do not:

- edit the version in `package.json`, `.release-please-manifest.json` or `CHANGELOG.md` by hand;
- run `npm publish` locally (only the first 0.1.0 publish was manual, to bootstrap Trusted Publishing);
- create `v*` tags manually.

Config files: `release-please-config.json` (release type `node`, tags `vX.Y.Z` without component,
changelog sections) and `.release-please-manifest.json` (current version).

## CI

`.github/workflows/ci.yml` runs `npm ci && npm run build` on PRs and pushes to `main`. Release PRs are
opened with `GITHUB_TOKEN`, so CI does not run on them; the publish job builds anyway.

## Caveats

- This scrapes unofficial Apple endpoints; breakage after Apple site changes is expected — check
  `src/privacy.ts` and the upstream package first.
