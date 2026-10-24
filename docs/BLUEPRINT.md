# Plan: `adsense-site-factory`, a template repo that turns keyword research into a deployed, AdSense-ready site

## Context
Building calculatorporch.com this month took a long chat: dozens of decisions, corrections and checks. You want a **separate, reusable repository** so the next site starts from a copy ("Use this template") and runs as a **pipeline of dedicated agents with hard gates**, not a conversation.

- **calculatorporch** stays untouched. It's the reference: its finalized verdicts (CI gates, security rules, the Cloudflare free-plan checklist, AdSense gate, SEO rules) get generalized into the template.
- **The niche is generic:** it comes out of the keyword research.
- **Cost:** free tools only.

**Pattern ("JEV", the free version):** an agent *proposes* (a file), a deterministic script or CI job *decides* (pass or fail, the same answer every time), code *acts*. It's built on Claude Code's official features: subagents, skills, hooks, `/goal` and `/loop` (code.claude.com docs).

## Decisions (yours, plus research verdicts)
| Topic | Decision |
|---|---|
| Location | `C:\Work\adsense-site-factory`, its own git repo. You create the empty GitHub repo and tick **Template repository** (GitHub's way to start new projects from it; better than a fork). |
| Hosting | **Cloudflare Pages first** for static sites. The architect switches to **Workers static assets** when the app needs server-side features. Free plan only. The Cloudflare reviewer runs only when a Cloudflare target is chosen. |
| Paid tools | None. Keyword Planner CSVs and competitor DR come from you. KD comes from the free SERP check (Claude's WebSearch plus your input; **no automated Google scraping**, which breaks Google's terms). |
| KD | Keyword Planner's "Competition" is **advertiser bidding, not SEO difficulty** (Google Ads API docs). It's kept as a commercial-value signal only. |
| Seasonality | Computed from Keyword Planner's 12 monthly columns. A seed is rejected when its peak/median ratio is above the configured threshold. |
| Bots | Allow Googlebot, Bingbot, `Mediapartners-Google` (AdSense; it **ignores `*`**, so it gets its own line, per Google's crawler docs), `AdsBot-Google`, `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`. Training bots (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`) are a per-project choice, enforced with Cloudflare AI Crawl Control (free). |
| Lighthouse | Accessibility, Best Practices and SEO = **100**; Performance **≥ 90 on mobile** before ads; plus Core Web Vitals limits (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1). A flat 100 isn't stable in lab runs. |
| Competitors | The lowest-DR competitor seeds the keyword research. The others are analysed with Replica / rea on **public pages only**, for structure and UX gaps. **No copying** (copyright, and AdSense's "unoriginal content" policy). |
| Excel input | CSV/TSV only ("Save as CSV UTF-8"). Excel parsing needs a third-party package with a poor security history on npm. |
| Agents in CI | CI runs free deterministic scripts. Claude-in-CI (`claude-code-action`) needs a paid API key, so it's left out (documented as optional). |

## Repository layout (new files)
```
adsense-site-factory/
  CLAUDE.md               rules: free-only, trust policy, gates, never-do (generalized from calculatorporch/CLAUDE.md)
  AGENTS.md               agent map, pipeline, gate table (read by any coding agent)
  README.md               "Use this template → open in Claude Code → /start"
  factory.config.json     domain, hosting (pages|workers), thresholds (min volume, max KD, seasonality ratio), bot policy, locales
  skills.lock.json        every external skill or plugin: repo, pinned commit SHA, tier, license, reviewed date
  .mcp.json               official servers only (see MCP list); free ones enabled
  .claude/agents/*.md     18 agents (below)
  .claude/skills/         start, today, gate, deploy-production (ported), keyword-pipeline
  .claude/settings.json   permissions (deny reading .env* and secrets, deny push to main), hooks (lint and secret scan after edits)
  research/inputs/        you drop: competitors.csv (domain, DR), Keyword Planner CSVs per competitor
  research/out/           generated: keywords.json, clusters.json, keyword-map.json, recon/<competitor>.md
  docs/templates/         PRD, DESIGN.md (google-labs-code/design.md format), ARCHITECTURE, SECURITY, CONTENT-STRATEGY, GROWTH-90
  app/ components/ lib/   generic Next.js static-export starter (registry-driven pages: tool, guide, hub, trust pages, consent, optional GA4)
  scripts/                deterministic gates (below)
  .github/workflows/      CI/CD (below)
```

## Agents and gates (each agent writes a file; a script decides)
| # | Agent | Uses (skills / MCP) | Gate that decides |
|---|---|---|---|
| 1 | **orchestrator** (`/start`) | `/goal`, the ledger | Each stage's gate passed before the next starts |
| 2 | **competitor-recon** | replica-recon, replica-diff, rea (after review), marketingskills `competitors`, Playwright MCP | `recon/*.md` per competitor; the unique-text check shows no copied text |
| 3 | **keyword-researcher** | claude-seo `seo-cluster`, searchfit `keyword-clustering`, `programmatic-seo` | `kp-ingest` → `keyword-select` → `cluster`: every keyword has exactly one owner URL; no seasonal seeds; KD ≤ max; anti-stuffing (secondary-keyword cap) |
| 4 | **content-strategist** | searchfit `content-strategy` / `content-brief`, marketingskills `schema` / `ai-seo`, claude-seo `seo-geo` / `seo-schema` | Briefs exist for wave 1; JSON-LD plan per page type; `llms.txt` generated |
| 5 | **growth-strategist** (90 days, ADHD-friendly) | marketing-loops, marketing-ideas, **marketing-council (Hormozi lens)**, customer-research | `GROWTH-90.md` + `growth/plan.json` validates (1 task/day, ≤ 45 min, a "done" check each) |
| 6 | **architect** | system-design, site-architecture, cloudflare skills, Cloudflare docs MCP | `ARCHITECTURE.md`; `hosting` set in config; Pages vs Workers rule applied |
| 7 | **designer** | **ui-ux-pro-max**, awesome-design-md (reference), **genjutsu** (motion, optional), design-system, replica-design | `DESIGN.md` valid; contrast check AA; fonts self-hosted with `font-display: swap` |
| 8 | **coder** | anthropics `frontend-design`, cloudflare skills | `npm run verify` |
| 9 | **harness** (tests) | anthropics `webapp-testing`, Playwright MCP | Every new module or page has unit and e2e tests; coverage of the registry |
| 10 | **reconciler** | ECC (after review), replica-diff | Keyword map ↔ pages ↔ design ↔ briefs agree; parity report vs competitors |
| 11 | **seo-auditor** | claude-seo suite | `check-out`: titles, canonicals, sitemap, schema, links ≤ 3 deep |
| 12 | **adsense-gatekeeper** | (ported agent) | `adsense-gate.mjs`: required pages, certified consent for Europe and the UK, no ad code before approval, `ads.txt` only after, no placeholders, policy-risk scan |
| 13 | **secops-reviewer** | trailofbits skills (semgrep, supply-chain-risk-auditor), gha-security-review, security-and-hardening | gitleaks, semgrep, `npm audit` gate, CSP tests. If server code or forms exist: CSRF, path-traversal and rate-limit checks, plus Turnstile |
| 14 | **cloudflare-reviewer** (only for Cloudflare targets) | Cloudflare MCP (reads), this session's verified free-plan checklist | CAA, DNSSEC, HSTS ramp, NEL rule, bot policy, cache defaults, no Bot Fight Mode; free features only |
| 15 | **responsive-checker** | (ported) | e2e 320–1280 px: no horizontal scroll, touch targets |
| 16 | **performance-auditor** | Lighthouse CI (official), Chrome DevTools MCP | The budgets above |
| 17 | **devsecops-deployer** | (ported production-deploy), wrangler-action | Pre-prod workflow green on the production branch → your GO → deploy → `check:live` → rollback path |
| 18 | **doc-generator** | doc templates | `PRD.md`, `DESIGN.md`, `ARCHITECTURE.md`, `SECURITY.md`, `AGENTS.md` regenerated from the agents' outputs |

**Flow:** `/start` → recon → keywords (after you drop the CSVs) → strategy + 90-day plan → architecture → design → build + tests → reconcile → reviews (SEO, AdSense, SecOps, responsive, performance) → **pre-prod checks on the production branch** (+ Cloudflare reviewer) → your GO → deploy → live check → docs regenerated. Each stage is resumable from the ledger.

## Security checks (added at your request; run by secops-reviewer locally, and in `security.yml` + `preprod.yml`)
| Check | How it's tested (free) | Fails when |
|---|---|---|
| **Burp-style attack scan** | Burp Suite's automated scanner is **Professional-only** (PortSwigger docs); Community has no scanner. Free equivalent: **ZAP by Checkmarx**. The official `zaproxy/action-baseline` runs on every PR against the preview URL; `zaproxy/action-full-scan` runs weekly and before a release. | Any medium or high alert not in the reviewed exceptions file |
| **XSS** | CSP test (no `unsafe-eval`, third parties allow-listed); ESLint `no-unsanitized`; `dangerouslySetInnerHTML` only in `JsonLd.tsx`; the JSON-LD `</script>` escaping test; e2e injects `"><script>`, `javascript:` and event-handler payloads into every allow-listed query parameter and checks nothing runs or is echoed raw; ZAP's XSS rules | A payload runs, or appears unescaped |
| **CSRF** | Static site: confirmed that no endpoint accepts POST. If server code or forms exist: Origin/Referer check, `SameSite=Lax/Strict` cookies, a CSRF token or Turnstile, and a test that a cross-origin POST is refused | A cross-origin POST succeeds |
| **Path traversal** | Live probes: `/..%2f..%2fetc/passwd`, `/%2e%2e/`, `/..;/`, double-encoded and backslash variants. Semgrep rules on any server code (`path.join` / `fs` fed by request input) | Anything other than a 400/404 without file contents |
| **Rate limiting** | A short, capped burst (e.g. 60 requests in 10 s) against the project's own preview, never a third party. Static pages: confirm Cloudflare absorbs it. Endpoints, forms or Functions: require the free rate-limiting rule (checked through the Cloudflare MCP) and expect a `429` | An endpoint keeps answering 200 under the burst |
| **Private server URL exposure** | Scan `out/`, JS bundles and source maps for private IP ranges (10/8, 172.16/12, 192.168/16, 127/8), `localhost`, internal hostnames, `*.pages.dev` / `*.workers.dev` preview URLs, API keys and tokens (gitleaks rules too). Response headers: no `x-powered-by`, version banners or `via` leaks. DNS: no DNS-only A/AAAA/CNAME record that reveals an origin IP | Any match |
| **Served only through Cloudflare** | Every live response has `server: cloudflare` and `cf-ray`. Every web hostname in DNS is proxied (orange cloud). All page resources are same-origin or on the CSP allow-list. No direct-to-origin hostname answers | A resource or host bypasses Cloudflare |
| **Email spoofing** | Through DNS-over-HTTPS: SPF present; for domains that never send mail, `v=spf1 -all` plus a null MX; DKIM present when mail is used; DMARC present and ramped `p=none` → `quarantine` → `reject` on a dated schedule; optional MTA-STS + TLS-RPT | SPF, DKIM or DMARC missing, or DMARC stuck at `none` past its review date |

These run as `npm run check:security` (local, against a URL) and as jobs in `security.yml` / `preprod.yml`. Probes only ever target the project's own preview or production hosts.

## Trusted sources (`skills.lock.json`, checked on GitHub 2026-10-25)
- **Official:**
  - `anthropics/skills` and `anthropics/claude-plugins-official`;
  - `anthropics/claude-code-action` (optional, paid);
  - `cloudflare/skills` and `cloudflare/mcp-server-cloudflare`;
  - `github/github-mcp-server`, `microsoft/playwright-mcp` and `ChromeDevTools/chrome-devtools-mcp`;
  - `googleanalytics/google-analytics-mcp` and `GoogleChrome/lighthouse-ci`;
  - `cloudflare/wrangler-action`, `gitleaks/gitleaks-action` and Semgrep.
- **Security firm:** `trailofbits/skills`.
- **Community, review then pin to a commit:**
  - `nextlevelbuilder/ui-ux-pro-max-skill`, `VoltAgent/awesome-design-md` and `google-labs-code/design.md`;
  - `AThevon/genjutsu` (license unclear: confirm before vendoring);
  - `morluto/rea`, `affaan-m/ECC`, `AgriciDaniel/claude-seo` and `coreyhaines31/marketingskills`.
- **Caution:** `Jakeschincariol/replica-skill` (3 weeks old). Excluded: `zacker-tech/hormozi-skills` (no license), `mrgoonie/claudekit-skills` (no license). `/design-code` wasn't found, so it's left out until you send its source.

## MCP servers (`.mcp.json`)
- **Free:** Cloudflare (docs + API), GitHub (official), Playwright, Chrome DevTools, Google Analytics (read-only), Claude Docs.
- **Listed but off (paid):** Semrush, Ahrefs.
- **Not available:** an official Search Console server; that step stays manual.

## Deterministic scripts
- **Ported from calculatorporch** (generalized; calculator-specific parts removed):
  - `scripts/production-gate.mjs`, `check-out.mjs`, `check-live.mjs` (incl. CAA, DNSSEC and NEL checks) and `check-repo.mjs`;
  - `serve-out.mjs`, `flatten-segments.mjs`, `gen-public-files.mjs` (robots built from the bot policy, sitemap, `llms.txt`);
  - `audit.mjs` and `audits/{perf,a11y,unique-text,ga-live}.mjs`;
  - the `_headers` CSP tests and the consent/GA4 modules (`lib/consent.ts`, `lib/analytics.ts`, `components/Analytics.tsx`, `ConsentBanner.tsx`);
  - the SEO and content rules from `docs/05` and `docs/10` (URL structure `/{category}/{slug}/`, depth ≤ 3; tool pages 600–1,500 words, guides 800–1,500; never pad).
- **New:**
  - `scripts/research/kp-ingest.mjs`: Keyword Planner CSV, which arrives as UTF-16 TSV; parsed without new dependencies.
  - `keyword-select.mjs` and `cluster.mjs`.
  - `scripts/adsense-gate.mjs`, `scripts/growth/today.mjs` and `scripts/design/contrast.mjs`.
  - Lighthouse CI config with the budgets above.
- **Dependencies:** the calculatorporch set plus `@lhci/cli` only, installed per the security/03 checklist and the 7-day rule.

## CI/CD (GitHub Actions, free; every action pinned to a commit SHA)
- **`ci.yml`:** check:repo, audit, lint, typecheck, unit, build, e2e.
- **`security.yml`:** gitleaks, `npm audit` gate, Semgrep.
- **`lighthouse.yml`:** budgets on the built site.
- **`preprod.yml`:** on PRs to the production branch, runs every gate: adsense-gate, check-out, responsive e2e, Lighthouse, security.
- **`deploy-pages.yml` / `deploy-workers.yml`:** wrangler-action with a scoped token secret, behind the `production` environment.
- **`live-check.yml`:** daily.

**Private repo caveats** (to verify during the build): CodeQL and dependency-review need GitHub Advanced Security on private repos, and environment approval rules may need a paid GitHub plan. If so, the template is documented as **public** (free), or runs those checks locally instead.

## The 90-day growth plan, ADHD-friendly
- **Daily:** one task, 25–45 minutes, with a clear "done" check.
- **Weekly:** a theme; Monday planning and Friday review take 10 minutes each.
- **No overload:** at most 3 open items, plus a parking lot for new ideas.
- **`/today`:** shows only today's task and your streak (`growth/plan.json`). Optional local reminder through Claude's scheduled tasks (free).

## Build phases
- **Phase 0 (here, first):** create the folder, `git init`, `package.json` with all npm script names and dependencies frozen, the folder skeleton, and the README/CLAUDE.md stubs. This is the contract the parallel steps build on.
- **Then in parallel** (separate files, and no session edits `package.json`):
  - **A:** governance and agents (`.claude/`, `AGENTS.md`, `CLAUDE.md`, `skills.lock.json`, `.mcp.json`, doc templates).
  - **B:** keyword pipeline (`scripts/research/*`, `research/`, its tests and fixtures).
  - **C:** starter app and ported gates (`app/`, `components/`, `lib/`, `public/`, `scripts/` except research and growth, tests).
  - **D:** CI/CD workflows (`.github/`).
- **Phase E (here, last):** wire `/start` end to end and run the verification below.

## Verification
1. `npm run verify` is green on the starter: lint, typecheck, unit, build, check-out, e2e.
2. Pipeline dry run: a fixture Keyword Planner CSV (clearly labelled fake data) → keywords → clusters → keyword map. Seasonal and over-KD seeds are rejected; every keyword has exactly one owner.
3. `adsense-gate`, `check-out` and a Lighthouse run on the built starter meet the budgets. Gitleaks, Semgrep and `npm audit` are clean.
4. CI: push to GitHub, and all workflows pass on a PR. The deploy job is checked as a dry run without a token.
5. Cloudflare reviewer: a read-only run against the calculatorporch zone as a known-good reference (reads only).
6. `/start` on a blank copy reaches the "drop your CSVs" step, then completes with the fixture.
7. Security: `npm run check:security` passes against the starter's preview deployment, and a ZAP baseline scan has no medium or high alerts. Planted test cases prove each check fails when it should:
   - a fake private IP in a bundle;
   - an XSS payload echoed raw;
   - a missing DMARC record;
   - an unproxied DNS record.

## Honest limits
- No check can guarantee AdSense approval or rankings; Google decides.
- DR and KD need either your input or paid tools.
- The template ships a generic starter; each project's look comes from the designer stage.
