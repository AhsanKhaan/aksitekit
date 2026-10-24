# Trusted sources: skills, plugins, MCP servers and GitHub Actions

`skills.lock.json` is the machine-readable list; this page explains it. **Agents use only what's listed here, at the
pinned commit, within its status.** Anything else needs the owner's yes first.

Checked on GitHub on 2026-10-25: the commit is each repository's default-branch HEAD from the public API
(`GET https://api.github.com/repos/{owner}/{repo}/commits/HEAD`), the license is GitHub's detected SPDX id, and for
GitHub Actions the release pin is the newest semver tag's commit (`git ls-remote --tags`).

## Tiers
| Tier | Meaning | Rule |
|---|---|---|
| **official** | Published by the vendor of the service or tool | Pin and use |
| **security-firm** | Published by an established security firm | Pin and use |
| **community** | Individual or community maintainers | Review, then pin; re-review on every pin change |
| **caution** | Young or unproven | Use only the parts named in its notes |
| **excluded** | No license or failed review | Never used |

## Statuses
| Status | Meaning |
|---|---|
| `approved` | Agents may use it at the pinned commit |
| `approved-with-limits` | Agents may use it within the limits in its notes |
| `pending-review` | Not used until the owner records a review and a yes below |
| `optional-paid` | Needs a paid plan or API, so it's off |
| `excluded` | Never used |

## The sources
| Repo | Tier | Status | License | Purpose | Used by | Reviewed | Commit (default branch) | Release pin |
|---|---|---|---|---|---|---|---|---|
| [anthropics/skills](https://github.com/anthropics/skills) | official | approved | Apache-2.0 for most skills; docx, pdf, pptx and xlsx are source-available (per its README) | Anthropic example skills: frontend design and Playwright web-app testing (`frontend-design`, `webapp-testing`) | coder, harness | 2026-10-25 | `dbd4588f9e10` | — |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | official | approved | Apache-2.0 | Anthropic's official plugin marketplace (`frontend-design`) | coder | 2026-10-25 | `58267944f921` | — |
| [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) | official | optional-paid | MIT | Claude in CI. Off: it needs a paid Anthropic API key | — | 2026-10-25 | `925afb53776c` | `v1.0.262` `925afb53776c` |
| [cloudflare/skills](https://github.com/cloudflare/skills) | official | approved | Apache-2.0 | Cloudflare platform skills (Pages, Workers, Wrangler) (`wrangler`, `workers-best-practices`, `web-perf`) | architect, coder | 2026-10-25 | `86505e44f87d` | — |
| [cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare) | official | approved | Apache-2.0 | Cloudflare domain MCP servers, including the docs server (docs.mcp.cloudflare.com) | architect, cloudflare-reviewer | 2026-10-25 | `a21972e21928` | — |
| [cloudflare/mcp](https://github.com/cloudflare/mcp) | official | approved | Apache-2.0 | Cloudflare API MCP server (mcp.cloudflare.com, Code Mode). Reads free; writes only with the owner's yes per call | cloudflare-reviewer, devsecops-deployer | 2026-10-25 | `550e1be82b22` | — |
| [github/github-mcp-server](https://github.com/github/github-mcp-server) | official | approved | MIT | GitHub MCP server, read-only tool set | devsecops-deployer, orchestrator | 2026-10-25 | `f38526264abb` | — |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | official | approved | Apache-2.0 | Playwright browser automation over MCP (headless, isolated, ad hosts blocked) | competitor-recon, harness, responsive-checker | 2026-10-25 | `0c4107acbecb` | — |
| [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | official | approved | Apache-2.0 | Chrome DevTools traces and Lighthouse over MCP (usage statistics off) | performance-auditor | 2026-10-25 | `ada7963246c0` | — |
| [googleanalytics/google-analytics-mcp](https://github.com/googleanalytics/google-analytics-mcp) | official | approved | Apache-2.0 | Google Analytics 4 reports over MCP, read-only | growth-strategist | 2026-10-25 | `ce84226bf4ce` | — |
| [GoogleChrome/lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci) | official | approved | Apache-2.0 | Lighthouse CI budgets (run as npx @lhci/cli@0.15.1) | performance-auditor | 2026-10-25 | `85d33432a914` | — |
| [cloudflare/wrangler-action](https://github.com/cloudflare/wrangler-action) | official | approved | Apache-2.0 | Deploys to Cloudflare Pages or Workers from GitHub Actions with a scoped token secret | devsecops-deployer | 2026-10-25 | `a17640ae5ec0` | `v4.1.3` `953926a2e218` |
| [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks) | official | approved | MIT | Secret scanner CLI (MIT). Preferred over gitleaks-action: download the release and verify its checksum | secops-reviewer | 2026-10-25 | `5f6ec56cfa6f` | `v8.30.1` `83d9cd684c87` |
| [gitleaks/gitleaks-action](https://github.com/gitleaks/gitleaks-action) | official | approved-with-limits | Gitleaks-Action EULA (source-available since v2; MIT before) | Secret scanning in GitHub Actions | secops-reviewer | 2026-10-25 | `bcfb9cce6353` | `v3.0.0` `e0c47f4f8be3` |
| [semgrep/semgrep](https://github.com/semgrep/semgrep) | official | approved-with-limits | LGPL-2.1 | SAST (Semgrep Community Edition) | secops-reviewer | 2026-10-25 | `087e93b3a1fd` | — |
| [zaproxy/action-baseline](https://github.com/zaproxy/action-baseline) | official | approved | Apache-2.0 | ZAP baseline scan on every PR against the preview URL (the free equivalent of Burp Pro's scanner) | secops-reviewer | 2026-10-25 | `72166cb1b917` | `v0.15.0` `de8ad967d354` |
| [zaproxy/action-full-scan](https://github.com/zaproxy/action-full-scan) | official | approved | Apache-2.0 | ZAP full scan, weekly and before a release | secops-reviewer | 2026-10-25 | `373906d606ca` | `v0.13.0` `3c5838814990` |
| [actions/checkout](https://github.com/actions/checkout) | official | approved | MIT | GitHub first-party: check out the repository in workflows | devsecops-deployer | 2026-10-25 | `f548e57e544e` | `v7.0.1` `3d3c42e5aac5` |
| [actions/setup-node](https://github.com/actions/setup-node) | official | approved | MIT | GitHub first-party: set up Node.js in workflows | devsecops-deployer | 2026-10-25 | `949feb2413d6` | `v7.1.0` `949feb2413d6` |
| [actions/upload-artifact](https://github.com/actions/upload-artifact) | official | approved | MIT | GitHub first-party: keep reports from workflow runs | devsecops-deployer | 2026-10-25 | `cf430e030ddb` | `v7.0.2` `cf430e030ddb` |
| [trailofbits/skills](https://github.com/trailofbits/skills) | security-firm | approved | CC-BY-SA-4.0 | Trail of Bits security skills (`semgrep`, `supply-chain-risk-auditor`) | secops-reviewer | 2026-10-25 | `196a9073ab10` | — |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | community | approved | MIT | UI/UX style, palette and font-pairing reasoning (`ui-ux-pro-max`) | designer | 2026-10-25 | `d14efff8ed1f` | — |
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | community | approved | MIT | Example DESIGN.md files, for format only | designer | 2026-10-25 | `3b605329240c` | — |
| [google-labs-code/design.md](https://github.com/google-labs-code/design.md) | community | approved | Apache-2.0 | The DESIGN.md format spec and its linter (npm @google/design.md) | designer | 2026-10-25 | `6e5da5382f41` | — |
| [AThevon/genjutsu](https://github.com/AThevon/genjutsu) | community | approved-with-limits | unclear (NOASSERTION) | Motion design (optional) (`genjutsu`) | designer | 2026-10-25 | `1f518a71378b` | — |
| [morluto/rea](https://github.com/morluto/rea) | community | pending-review | MIT | Recon helper | competitor-recon | 2026-10-25 | `22b88300d0ec` | — |
| [affaan-m/ECC](https://github.com/affaan-m/ECC) | community | pending-review | MIT | Claude Code configuration collection | reconciler | 2026-10-25 | `90606c8315ee` | — |
| [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) | community | approved-with-limits | MIT | SEO audit and planning skills (`seo-cluster`, `seo-geo`, `seo-schema`, `seo-technical`, `seo-sitemap`, `seo-content`) | keyword-researcher, content-strategist, seo-auditor | 2026-10-25 | `6be93f45064f` | — |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | community | approved | MIT | Marketing and SEO skills (`competitors`, `programmatic-seo`, `schema`, `ai-seo`, `site-architecture`, `marketing-loops`, `marketing-ideas`, `marketing-council`, `customer-research`) | competitor-recon, keyword-researcher, content-strategist, architect, growth-strategist | 2026-10-25 | `e85f3cbc2e4a` | — |
| [Jakeschincariol/replica-skill](https://github.com/Jakeschincariol/replica-skill) | caution | approved-with-limits | MIT | App recon and parity scoring (`replica-recon`, `replica-diff`, `replica-design`, `replica-architect`) | competitor-recon, reconciler, designer, architect | 2026-10-25 | `77c9436fb3d1` | — |
| [getsentry/skills](https://github.com/getsentry/skills) | community | pending-review | Apache-2.0 | GitHub Actions security review (`gha-security-review`) | secops-reviewer | 2026-10-25 | `d12f250460ff` | — |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | community | pending-review | MIT | Secure-coding practices (`security-and-hardening`) | secops-reviewer | 2026-10-25 | `aeac41d4d005` | — |
| [searchfit/searchfit-seo](https://github.com/searchfit/searchfit-seo) | community | pending-review | MIT | Keyword clustering and content planning (`keyword-clustering`, `content-strategy`, `content-brief`) | keyword-researcher, content-strategist | 2026-10-25 | `c324a2e87c4d` | — |
| [zacker-tech/hormozi-skills](https://github.com/zacker-tech/hormozi-skills) | excluded | excluded | none | Hormozi-style offer skills | — | 2026-10-25 | `44c83820a55f` | — |
| [mrgoonie/claudekit-skills](https://github.com/mrgoonie/claudekit-skills) | excluded | excluded | none | Design and UI skills (`design-system`, `ui-styling`) | — | 2026-10-25 | `80113d86bc44` | — |

Full 40-character SHAs are in `skills.lock.json`.

## Packages pinned by version
| Package | Registry | Version | Published | Used in |
|---|---|---|---|---|
| `@playwright/mcp` | npm | 0.0.83 | 2026-09-28 | `.mcp.json` → `playwright` |
| `chrome-devtools-mcp` | npm | 1.11.0 | 2026-10-15 | `.mcp.json` → `chrome-devtools` (1.12.0 was under 7 days old) |
| `analytics-mcp` | PyPI | 0.7.0 | 2026-07-29 | `.mcp.json` → `google-analytics` (0.8.0 was under 7 days old) |
| `@google/design.md` | npm | 0.4.0 | 2026-07-27 | `npm run lint:design` (requested from Phase E) |
| `@lhci/cli` | npm | 0.15.1 | 2025-06-25 | `npm run audit:lighthouse` |

## Findings from this review (owner, please read)
1. **gitleaks-action is not open source since v2.** It runs under the Gitleaks-Action EULA, and repositories owned by a
   GitHub **organization** need a license key (free, but you sign up with name, email and company). Personal-account
   repositories need none. Recommendation: use the MIT **gitleaks CLI** in CI (download the release, verify its
   checksum), which Step D can do without any key.
2. **Three sources the blueprint's agent table uses are missing from its trusted list:** `getsentry/skills`
   (`gha-security-review`), `addyosmani/agent-skills` (`security-and-hardening`) and `searchfit/searchfit-seo`
   (`keyword-clustering`, `content-strategy`, `content-brief`). All three have clear licenses (Apache-2.0, MIT, MIT)
   but are `pending-review` until you decide.
3. **The designer's `design-system` skill comes from an excluded source** (`mrgoonie/claudekit-skills`, no repository
   license; so does `ui-styling`). The designer uses ui-ux-pro-max and the DESIGN.md spec instead.
4. **`system-design` (architect) has no identified source.** It stays unused until you name one.
5. **`cloudflare/mcp` was added:** the Cloudflare API MCP server now lives there, not in
   `cloudflare/mcp-server-cloudflare`.
6. **GitHub first-party actions** (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`) were added,
   because every action a workflow uses must be in this lock.
7. **Semgrep:** Community Edition only. The Trail of Bits skill can use Semgrep Pro when it's available; that's paid,
   so agents never enable it.
8. **genjutsu's license is unclear** (GitHub reports NOASSERTION): read it, but vendor nothing until you confirm.

## Owner review record
Fill a row when you review a `pending-review` source; then change its status in `skills.lock.json` in the same commit.

| Source | Decision (approve / reject) | Date | Notes |
|---|---|---|---|
| `morluto/rea` | pending | | |
| `affaan-m/ECC` | pending | | |
| `getsentry/skills` | pending | | |
| `addyosmani/agent-skills` | pending | | |
| `searchfit/searchfit-seo` | pending | | |
| `system-design` (source unknown) | pending | | |

## Reviewing or updating a pin
1. Read the diff between the pinned commit and the new one (`https://github.com/<repo>/compare/<old>...<new>`): new
   scripts, network calls, install hooks, telemetry, changed license, instructions that push agents to paid tools.
2. Check the license is still present and allows our use.
3. For a package, the version must be at least 7 days old (`npm view <pkg> time --json`).
4. Update `commit`, `commitDate`, `release` and `reviewed` in `skills.lock.json`, and this page, in one commit that says
   what you reviewed.
5. Never point anything at a branch name or `latest`; always a full commit SHA or an exact version.
