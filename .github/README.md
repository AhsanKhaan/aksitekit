# CI/CD (`.github/`)

GitHub Actions for the factory: free GitHub-hosted runners and free tools only. Agents propose; these workflows decide.
The npm scripts they call are the frozen names in `docs/CONTRACT.md`. Until Step C implements them
(`docs/TODO-step-c.md`), the workflows that call them fail. That's expected.

Claude in CI (`anthropics/claude-code-action`) is **not used**: it needs a paid Anthropic API key. It's an optional
add-on for an owner who chooses to pay; CI itself only runs deterministic scripts.

Labels: [M] checked on 2026-10-25 (API lookup or docs page, linked), [U] unverified.

## Workflows

The technology is the owner's choice at `/start` (`factory.config.json` → `build`): Next.js or any other. Builds run
`npm run build` (which runs `build.commands.build` through `scripts/framework.mjs`), and every job reads the site from
`build.outputDir`. Build steps set technology-neutral `SITE_URL` / `SITE_INDEXABLE` next to the Next.js
`NEXT_PUBLIC_*` names.

| File | Runs on | What it does | Decides |
|---|---|---|---|
| `workflows/ci.yml` | every PR, push to `main`, by hand | `npm ci` → `check:repo` → `audit` → `lint` → `typecheck` → `test` → `build` → Playwright Chromium → `test:e2e`; self-test of the helper scripts | each npm script's exit code |
| `workflows/security.yml` | every PR, push to `main`, Mondays 04:23 UTC, `deployment_status`, by hand | **static:** gitleaks over the full git history, the `npm audit` gate (`npm run audit`: high and critical fail), `npm audit signatures`, Semgrep registry rules. **ZAP baseline** (passive) against a preview: each successful `deployment_status` event that carries a URL, or by hand with `scan: baseline` and a URL. **ZAP full scan** (active) weekly and by hand (`scan: full`) before a release | gitleaks / Semgrep exit codes; `scripts/zap-gate.mjs` for ZAP |
| `workflows/lighthouse.yml` | every PR, push to `main`, by hand | builds, serves the output folder (`build.outputDir`) on port 4321, runs `npm run audit:lighthouse` (`npx @lhci/cli@0.15.1 autorun`), uploads `.lighthouseci/` | the budgets in `lighthouserc.json` (Step C) |
| `workflows/preprod.yml` | PRs whose base is `hosting.productionBranch`, by hand | **gates:** `gate:adsense`, `gate:design`, `check:release`, production build (incl. check-out), gitleaks on `out/`, `test:e2e` (incl. responsive 320–1280 px), Lighthouse. **preview:** finds the PR's Cloudflare Pages preview, then `check:security` and the ZAP baseline against it | every gate; skips while `project.domain` is empty |
| `workflows/deploy-pages.yml` | by hand from the production branch; green `ci` push run on `main` when `AUTO_DEPLOY` is `true` | only if `hosting.target` is `cloudflare-pages`: production build, `wrangler pages deploy <build.outputDir>`, then `check:live` | the `production` environment approval (the owner's GO), then `check:live` |
| `workflows/deploy-workers.yml` | same as above | only if `hosting.target` is `cloudflare-workers`: production build, `wrangler deploy` (Workers static assets from the project's `wrangler.jsonc`), then `check:live` | same as above |
| `workflows/live-check.yml` | daily 05:41 UTC, by hand | `check:live` and `check:security` against `LIVE_SITE_URL` (and `LIVE_PAGES_HOST`); skips while `LIVE_SITE_URL` is unset | the scripts' exit codes |
| `dependabot.yml` | weekly (Monday) | grouped npm and GitHub Actions updates with a 7-day cooldown (matches `.npmrc` `min-release-age=7`); security updates aren't delayed | CI on the Dependabot PR |

Helpers (Node, no dependencies; `ci.yml` runs their planted failing cases with `node .github/scripts/selftest.mjs`):
- `scripts/target-url.mjs`: every ZAP and `check:security` target must be one of this project's hosts: the host of
  `LIVE_SITE_URL` and its `www.`/apex twin, `LIVE_PAGES_HOST` and `*.LIVE_PAGES_HOST`, or the host of `PREVIEW_URL`.
  https only, no credentials, no port, no whitespace. Anything else fails, or is skipped for a `deployment_status`
  from another deployer.
- `scripts/zap-gate.mjs`: fails on any Medium or High alert whose rule isn't a reviewed exception, and on any alert of a
  rule set to `FAIL`. ZAP's own exit code isn't used, because it also fails on Low warnings.
- `scripts/preview-url.mjs`: waits for the Cloudflare Pages check run (or commit status) on the PR's head commit and
  takes the deployment URL it reports (falls back to the branch alias).
- `zap/rules.tsv`: ZAP's rule config and the reviewed exceptions. Each exception needs a reason and a review date;
  the gate fails on one reviewed more than 365 days ago. The owner approves every exception.

## Setup (the owner, once per project)

### Secrets (Settings → Secrets and variables → Actions)
| Secret | What | Where to store it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token scoped to this account only. Pages: **Account → Cloudflare Pages → Edit**. Workers: **Account → Workers Scripts → Edit**, plus **Zone → Workers Routes → Edit** only if `wrangler.jsonc` sets routes [U]. Nothing else; give it an expiry date. | **Environment secret on `production`** (public repos, or Pro/Team private repos), so only an approved deploy job can read it. On a private repo with GitHub Free it can only be a repository secret, readable by any workflow run in the repo. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID. | Same place as the token. |

No other workflow uses a secret. Secrets go to `wrangler-action` inputs, never into a `run:` script.

### Variables (Settings → Secrets and variables → Actions → Variables)
| Variable | Example | Used by |
|---|---|---|
| `LIVE_SITE_URL` | `https://example.com` | `NEXT_PUBLIC_SITE_URL` in production builds; `check:live` / `check:security` target; an allowed scan host. Set it before the first production deploy. |
| `LIVE_PAGES_HOST` | `example-site.pages.dev` | Pages previews (`*.example-site.pages.dev`) for preprod and ZAP; the weekly ZAP full scan target (`https://example-site.pages.dev/`, the same build as production, so the attacks never hit the custom domain); `check:live --pages`. |
| `PREVIEW_URL` (optional) | `https://staging.example.com` | A fixed preview when there is no Pages preview per PR (e.g. a Workers project). Takes priority in preprod and the full scan. |
| `CLOUDFLARE_PAGES_PROJECT` (optional) | `example-site` | Pages project name; defaults to `factory.config.json` `project.name`. |
| `AUTO_DEPLOY` (optional) | `true` | Deploy on every green `ci` push run on `main`. **Set it only after `production` has required reviewers** (below); otherwise a push would deploy with no GO. Unset: deploys run only by hand. |

### The `production` environment (Settings → Environments → New environment → `production`)
- **Required reviewers:** the owner. This approval is the GO for that commit (`CLAUDE.md`: never deploy without it).
  Leave "Prevent self-review" off while you're the only reviewer: it would block approving runs you started.
- **Deployment branches and tags:** selected branches → the production branch only.
- **Environment secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

### Cloudflare Pages (dashboard, Workers & Pages → the project → Settings → Build)
- Connect the project to this repository (Git integration) so every PR gets a preview. Preview branches: "All
  non-Production branches". Preview URLs aren't created for PRs from forks ([Cloudflare docs][cf-gh]).
- **Untick "Enable automatic production branch deployments"** ([Cloudflare docs][cf-branch]), so production goes only
  through `deploy-pages.yml` and its GO. Cloudflare documents manual deploys with wrangler for Git-integrated projects
  ([Direct Upload docs][cf-direct]).

### Branch protection on `main` (Settings → Rules or Branches)
Require pull requests and the checks `ci / verify`, `ci / workflow helpers self-test`, `security / *` and
`preprod / *`; block force pushes. Protected branches need a public repo, or GitHub Pro/Team/Enterprise for a private
one ([docs source][gh-protected]).

## The preview URL and `deployment_status` [U]

`security.yml` runs the ZAP baseline on each successful `deployment_status` event, using its `environment_url`.
Whether the Cloudflare Pages GitHub integration creates GitHub deployments is **unverified**: Cloudflare's GitHub
integration page only mentions check runs and commit statuses ([Cloudflare docs][cf-gh]), and a 2022 report says it
doesn't create deployments ([Zuplo][zuplo]). So the PR path doesn't depend on it:
- **preprod.yml** finds the preview from the Cloudflare check run or commit status on the head commit
  (`scripts/preview-url.mjs`), then runs `check:security` and the ZAP baseline against it.
- **By hand:** Actions → security → Run workflow → `scan: baseline`, `target_url: <preview URL>`; or preprod →
  `preview_url`.

A `deployment_status` run uses the workflow files of the deployed commit. Connect only deployers that never deploy
pull requests from forks (Cloudflare Pages creates no preview URLs for them, per [its docs][cf-gh]); otherwise a fork's
own workflow could run with this repository's secrets [U]. Keeping the Cloudflare secrets on the `production`
environment limits that to runs the owner approves.

After the first PR on a real project, check the PR's Cloudflare check names a `https://<hash>.<project>.pages.dev` URL.
If it names none, preprod falls back to the branch alias (`<branch>.<project>.pages.dev`: lowercased, each
non-alphanumeric character a hyphen, per [Cloudflare docs][cf-preview]; long branch names may be truncated [U], so
keep them short).

## Private-repo caveats [M] (checked on docs.github.com, 2026-10-25)

| Feature | Public repo | Private repo |
|---|---|---|
| **CodeQL / code scanning** | Free. | Needs a **GitHub Code Security** license, which can only be bought on GitHub Team or Enterprise ([code scanning][gh-cs], [Advanced Security][gh-ghas]). |
| **Dependency review** (`actions/dependency-review-action`) | Free ("available for all public repositories"). | Needs **GitHub Code Security** or **GitHub Advanced Security** enabled ([dependency review][gh-dr]). |
| **Environments** | All plans. | GitHub Free: **can't configure environments at all**; Pro and Team can ([manage environments][gh-env]). |
| **Required reviewers / wait timers** on an environment | All plans. | On Free, Pro and Team: **public repos only**, so a private repo needs GitHub Enterprise ([deployments and environments][gh-dep]). |
| **Environment secrets** | All plans. | GitHub Free: public repos only; Pro, Team or Enterprise for private ([deployments and environments][gh-dep]). |
| **Secret scanning and push protection** | Free, on by default. | Needs **GitHub Secret Protection** (Team or Enterprise) ([Advanced Security][gh-ghas]). gitleaks covers CI either way. |
| **Protected branches** | All plans. | Pro, Team or Enterprise ([docs source][gh-protected]). |
| **Actions minutes** | Free on standard GitHub-hosted runners. | 2,000 minutes a month on GitHub Free; usage is blocked when they run out unless a payment method is on file ([Actions billing][gh-bill]). The weekly ZAP full scan can use up to 120 of them. |

A workflow that names an environment that doesn't exist creates it, with no protection rules or secrets
([manage environments][gh-env]). So on a private repo without Enterprise, `environment: production` is **not** a GO:
keep `AUTO_DEPLOY` unset and deploy only by hand (Run workflow is then the owner's GO), and the Cloudflare token is a
repository secret that any workflow can read.

**Recommended: make the repository public.** Everything above is then free: the `production` approval gate,
environment secrets, protected branches, secret scanning with push protection, and two extra free checks:
- **CodeQL:** Settings → Code security → Code scanning → CodeQL analysis → **Default setup** (no workflow file).
- **Dependency review:** add this job to `security.yml` (it only runs on public repos):

  ```yaml
  dependency-review:
    if: github.event_name == 'pull_request' && !github.event.repository.private
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
    steps:
      - uses: actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0
        with:
          fail-on-severity: high
  ```

A public repo exposes the source, the research inputs you commit, and the Actions logs. Keep Keyword Planner exports
and anything private out of the repository if you go public.

## Security rules every workflow follows
- **Pinned:** every third-party action to a full 40-character commit SHA with a version comment; container images by
  digest; the gitleaks binary by SHA-256; `wranglerVersion` exact and at least 7 days old.
- **gitleaks as a binary, not `gitleaks/gitleaks-action`:** the action needs a `GITLEAKS_LICENSE` key for repositories
  owned by an organisation (free, but issued through a sign-up form at gitleaks.io, and the action is under a custom
  license since v2) ([gitleaks-action README][gl-action]). The release binary has neither condition.
- **Least privilege:** `permissions: {}` at workflow level, then per job; only `contents: read`, plus `checks: read` and
  `statuses: read` for the preview lookup. Nothing writes to the repository, issues or PRs (ZAP's issue writing is off).
- **No `pull_request_target`.** `workflow_run` (deploys) acts only on `push` runs of this repository and deploys the
  exact commit CI tested, and only if it's still the branch head.
- **No injection:** no `${{ … }}` inside any `run:`; event values, inputs and variables reach scripts through `env:`.
  Scan targets are validated by `target-url.mjs` before ZAP gets them.
- **Secrets never printed:** only the deploy jobs see them, through action inputs; gitleaks runs with `--redact`;
  `actions/checkout` never persists credentials; no dependency cache in jobs that hold secrets.
- **Bounded:** `concurrency` on every workflow (PR runs cancel stale ones; deploys share one `deploy-production` lock
  and never cancel), and `timeout-minutes` on every job.

## Rollback
1. Fastest: Cloudflare dashboard → the project → Deployments → an earlier production deployment → **Rollback**.
2. Through CI: Actions → deploy-pages (or deploy-workers) → Run workflow on the production branch with `commit` = an
   earlier commit on it. It goes through the same approval and `check:live`.
Then fix forward with a PR.

## Pins and how to bump them

| Pin | Version | Ref [M] |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| `cloudflare/wrangler-action` | v4.1.3 | `953926a2e2182532811c01a25e53647d93bf07c0` (annotated tag `2ef9f398…` dereferenced) |
| `zaproxy/action-baseline` | v0.15.0 | `de8ad967d3548d44ef623df22cf95c3b0baf8b25` (annotated tag `6c5a0075…` dereferenced) |
| `zaproxy/action-full-scan` | v0.13.0 | `3c58388149901b9a03b7718852c5ba889646c27c` (annotated tag `bee4e5be…` dereferenced) |
| ZAP image | `ghcr.io/zaproxy/zaproxy:2.17.0` (= `stable` on 2026-10-25) | `sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6` |
| Semgrep image | `semgrep/semgrep:1.181.0` | `sha256:81474464c1f07483ba0682a44787fd93c91397419762a04abe2bafaae396304b` |
| gitleaks binary | v8.30.1 `linux_x64` | SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` |
| wrangler (installed by wrangler-action) | 4.151.1 | npm, published 2026-10-16 |

Dependabot bumps the actions (SHA and comment). Bump the rest by hand, about monthly:
- **Action SHA:** `GET https://api.github.com/repos/{owner}/{repo}/git/ref/tags/{tag}`; if `object.type` is `tag`,
  follow `GET /repos/{owner}/{repo}/git/tags/{sha}` to the commit. Cross-check with
  `git ls-remote https://github.com/{owner}/{repo} 'refs/tags/{tag}^{}'`.
- **Image digest:** `docker buildx imagetools inspect <image>:<tag>` (the index digest), or the registry's manifest API.
- **gitleaks:** the release's `gitleaks_<version>_checksums.txt`, line `linux_x64.tar.gz`.
- Keep the 7-day rule: no version published less than a week ago.

## What these workflows expect from Step C [U]
These are the interfaces assumed (as specified in `docs/TODO-step-c.md`). Step C confirms them or asks
Step E to adjust the workflows:
- `npm run serve` serves `build.outputDir` (whatever technology built it) with the `_headers` rules on `PORT` (default 4321); Playwright's `webServer` does the same.
- `lighthouserc.json` collects from `http://localhost:4321/…` (or sets `startServerCommand` / `staticDistDir`, which the
  workflows detect), and uploads to the `filesystem` target, not `temporary-public-storage` (public links).
- Production builds in CI set `SITE_ENV=production`, `NEXT_PUBLIC_SITE_URL` (= `LIVE_SITE_URL`) and
  `NEXT_PUBLIC_INDEXABLE=true`. `production-gate.mjs` must apply its production checks when `SITE_ENV=production`,
  because these builds don't run inside Cloudflare (`CF_PAGES` is unset). The Lighthouse lab build sets only
  `NEXT_PUBLIC_INDEXABLE=true`.
- `npm run check:live -- <https://site> [--pages <project>.pages.dev]` and `npm run check:security -- <https://url>`;
  both also get `LIVE_SITE_URL` and `LIVE_PAGES_HOST` in env.
- ESLint covers `.github/scripts/*.mjs` (Node ESM, Node globals).

[cf-gh]: https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
[cf-branch]: https://developers.cloudflare.com/pages/configuration/branch-build-controls/
[cf-direct]: https://developers.cloudflare.com/pages/get-started/direct-upload/
[cf-preview]: https://developers.cloudflare.com/pages/configuration/preview-deployments/
[zuplo]: https://zuplo.com/blog/2022/04/28/github-actions-after-cloudflare-pages-deploy
[gh-cs]: https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning
[gh-ghas]: https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security
[gh-dr]: https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review
[gh-env]: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
[gh-dep]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
[gh-protected]: https://github.com/github/docs/blob/main/data/reusables/gated-features/protected-branches.md
[gh-bill]: https://docs.github.com/en/billing/concepts/product-billing/github-actions
[gl-action]: https://github.com/gitleaks/gitleaks-action#environment-variables
