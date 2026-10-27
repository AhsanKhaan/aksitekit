# Build contract (Phase 0)

Every build step (A–D) works to this contract so they can run in parallel without touching each other's files.
**Nobody edits `package.json` or `package-lock.json` except Phase 0 and Phase E.** If a step needs a script or a
dependency changed, it writes the request into its report instead.

**Read first:** `docs/BLUEPRINT.md` (the approved plan). Everything in this repository is generic: no project-specific
domain, brand, keys or IDs.

**Step C is deferred:** its instructions are in `docs/TODO-step-c.md`. Steps A, B and D must not depend on Step C files
existing; they call the npm scripts named below, which Step C implements later.

**Technology is a choice, not a given.** `/start` asks every new copy: Next.js (the built-in starter) or any other
technology. The choice lives in `factory.config.json` → `build` (`framework`, `outputDir`, `commands.build`,
`commands.dev`). The npm script names below never change: `dev` and `build` run the chosen technology through
`scripts/framework.mjs`, and every gate, workflow and check reads the site from `build.outputDir`, never a hard-coded
folder.

## File ownership
| Step | Owns | Must not touch |
|---|---|---|
| A: governance and agents | `CLAUDE.md`, `AGENTS.md`, `README.md`, `.claude/**`, `.mcp.json`, `skills.lock.json`, `docs/templates/**`, `docs/SKILLS.md`, `docs/MCP.md` | app code, scripts, workflows |
| B: keyword pipeline | `scripts/research/**`, `research/**`, `tests/research/**` | everything else |
| C: starter app and gates | `app/**`, `components/**`, `lib/**`, `content/**`, `public/**`, `scripts/*.mjs`, `scripts/audits/**`, `scripts/design/**`, `scripts/growth/**`, `tests/**` except `tests/research/**`, root configs (`next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `postcss.config.mjs`, `lighthouserc.json`) | `scripts/research/**`, `.claude/**`, `.github/**` |
| D: CI/CD | `.github/**` | everything else |
| E: integration | anything, after A–D land | none |

## npm scripts (frozen; implemented by the step in brackets)
| Script | Runs | Step |
|---|---|---|
| `dev`, `build`, `serve` | `scripts/gen-public-files.mjs`, `production-gate.mjs`, `scripts/framework.mjs` (runs `build.commands.dev` / `build.commands.build`; Next.js default adds `flatten-segments.mjs`), `check-out.mjs`, `serve-out.mjs` (serves `build.outputDir`) | E (`framework.mjs`), C (the rest) |
| `lint`, `typecheck`, `test`, `test:e2e` | ESLint, `tsc`, Vitest, Playwright | C (configs), B (its own tests) |
| `check:repo`, `check:release`, `check:live`, `check:security` | `scripts/check-repo.mjs`, `tests/content.test.ts --mode release`, `scripts/check-live.mjs`, `scripts/check-security.mjs` | C |
| `audit`, `audit:perf`, `audit:a11y`, `audit:unique`, `audit:ga` | `scripts/audit.mjs`, `scripts/audits/*.mjs` | C |
| `audit:seo`, `check:seo-live` | `scripts/audits/seo-checks.mjs` (built output; `--live <url> [paths]`), config `seo-checks.json`. `build` also runs it after `check-out.mjs` (`docs/SEO-GATE.md`) | E (done, ported from calculatorporch) |
| `audit:lighthouse` | `npx @lhci/cli@0.15.1 autorun` with `lighthouserc.json` (no installed dependency) | C (config), D (CI action) |
| `gate:adsense`, `gate:design` | `scripts/adsense-gate.mjs`, `scripts/design/contrast.mjs` | C |
| `research:ingest`, `research:select`, `research:cluster`, `research:all` | `scripts/research/*.mjs` | B |
| `growth:today` | `scripts/growth/today.mjs` reading `growth/plan.json` | C |
| `verify` | check:repo → audit → lint → typecheck → test → build → test:e2e | all |

## Data formats
- `factory.config.json`: project inputs and thresholds (root). Validate with zod.
- `research/inputs/competitors.csv`: `domain,dr,notes`, plus an optional `brands` column for the keyword pipeline's
  brand filter.
- `research/inputs/kp/<competitor>.csv`: Google Keyword Planner export (UTF-16 LE, tab-separated, two title rows, then a
  header row with `Keyword`, `Avg. monthly searches`, `Competition`, `Competition (indexed value)`, bid columns and 12
  `Searches: <Mon YYYY>` columns). UTF-8 CSV must also be accepted.
- `research/inputs/kd.csv` (optional): `keyword,kd,source,checked` from the free SERP check or the owner.
- `research/out/keywords.json`: normalized rows `{ keyword, volume, monthly[12], seasonality, competitionAds, kd, kdSource, sources[] }`.
- `research/out/selected.json`: rows kept, plus `rejected[]` each with a `reason` (`low-volume`, `kd`, `seasonal`, `brand`, `duplicate`).
- `research/out/keyword-map.json`: `[{ url, type: tool|guide|hub|instance, category, primary, secondary[], intent, cluster, evidence }]`;
  every keyword belongs to exactly one URL or is listed as discarded.
- `growth/plan.json`: `{ start, days: [{ day, week, theme, task, minutes, doneWhen, status }] }`.

## Rules that bind every step
- Free tools only. A step that would need a paid tool stops and asks the owner; if refused, it proposes a free alternative.
- Trusted sources only (`skills.lock.json`, pinned commits). No new npm dependency without the security checklist and a
  version at least 7 days old (`.npmrc` enforces `min-release-age=7`, `ignore-scripts=true`, `save-exact=true`).
- Fixtures are clearly fake data. Never invent facts, sources, reviews or metrics in content.
- Commit on a branch named for the step (`step/a-governance`, `step/b-research`, `step/c-starter`, `step/d-cicd`); never on `main`.
