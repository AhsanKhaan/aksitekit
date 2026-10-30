# AK Site Kit handbook (technical reference)

Everything about how `aksitekit` works, in detail. To start a website, read the [README](../README.md) first. Built with [Claude Code](https://code.claude.com). Not affiliated with or endorsed by Anthropic.

A **template repository** that turns keyword research into a deployed, AdSense-ready static website. A team of Claude Code
agents does the work; deterministic scripts and CI jobs decide whether each step passed. You start a new site from a
copy of this repository instead of a long chat.

- **Agents propose, scripts decide, code acts.** Every stage writes a file, and its gate (an npm script or a CI job)
  passes or fails it, the same way every time.
- **Free tools only.** If a step would need a paid tool, the agent stops and asks you first; if you say no, it offers a
  free alternative.
- **Generic.** No niche is built in: the niche comes out of your keyword research.

---

## Contents
1. [Status](#1-status)
2. [Quick start](#2-quick-start)
3. [What you provide](#3-what-you-provide)
4. [The pipeline](#4-the-pipeline)
5. [The agents](#5-the-agents)
6. [Skills, trusted sources and MCP servers](#6-skills-trusted-sources-and-mcp-servers)
7. [Keyword research rules](#7-keyword-research-rules)
8. [Content, SEO and crawler rules](#8-content-seo-and-crawler-rules)
9. [Security checks](#9-security-checks)
10. [CI/CD and deployment](#10-cicd-and-deployment)
11. [Quality budgets](#11-quality-budgets)
12. [The 90-day growth plan (ADHD-friendly)](#12-the-90-day-growth-plan-adhd-friendly)
13. [npm scripts](#13-npm-scripts)
14. [Repository map](#14-repository-map)
15. [Rules for agents](#15-rules-for-agents)
16. [Research corrections built in](#16-research-corrections-built-in)
17. [Honest limits](#17-honest-limits)

---

## 1. Status
| Part | State | Where |
|---|---|---|
| Phase 0: scaffold, npm script contract, locked dependencies, config | ✅ done | `package.json`, `factory.config.json`, `docs/CONTRACT.md` |
| Step A: rules, 18 agents, 5 skills, gate runner, hooks, trusted-source lock, MCP config, doc templates | ✅ done | `CLAUDE.md`, `AGENTS.md`, `.claude/`, `skills.lock.json`, `.mcp.json`, `docs/` |
| Step B: keyword pipeline (ingest → select → cluster), 55 tests [M] | ✅ done | `scripts/research/`, `research/`, `tests/research/` |
| Step D: GitHub Actions (CI, security, Lighthouse, pre-prod, deploys, live check), Dependabot | ✅ done (not yet run on GitHub) | `.github/` |
| Step C: Next.js starter (one example page of each type), every gate script, 270 unit and 41 e2e tests [M: 2026-10-29 runs] | ✅ done | `app/`, `components/`, `lib/`, `content/`, `scripts/`, `tests/`, `docs/TODO-step-c.md` |

**Lint on TypeScript 7.** typescript-eslint, which eslint-config-next loads, needs the TypeScript compiler API, and
TypeScript 7.0 has none. So `typescript` is an alias for Microsoft's TypeScript 6.0 API package, and
`@typescript/native` is the TypeScript 7.0.2 compiler that `npm run typecheck` runs (`docs/TODO-step-c.md` →
Lint on TypeScript 7). `npm run verify` passes end to end [M: 2026-10-29]. On the bare template (no `project.domain`
yet), run it with `SITE_URL=https://example.com`: the SEO gate refuses to guess a site URL.

On GitHub, CI runs in **template mode**: the site jobs (build, lint, e2e, Lighthouse, pre-production, deploys) show as
*skipped*, and the template's own checks (tests, helper self-tests, gitleaks, Semgrep, npm audit) run and pass.

The approved design is `docs/BLUEPRINT.md`; who owns which files is `docs/CONTRACT.md`.

---

## 2. Quick start
1. On GitHub, click **Use this template** → create your repository. (Use the template feature, not a fork: a fork stays
   linked to this repository.)
2. Clone it, then install the locked dependencies:
   ```bash
   npm ci
   ```
3. Open the folder in Claude Code. If Claude Desktop shows **Trust repository**, accept it. Sign in to the MCP servers
   you want through `/mcp` (all optional; see §6).
4. Run **`/start`**. It asks for your domain, 2–5 competitors with their DR, and **which technology to build with**
   (below). It picks the lowest-DR competitor as your keyword seed and tells you when to drop your Keyword Planner CSVs
   (§3).
5. Answer its questions as stages finish. `/start resume` continues from the ledger (`reports/ledger.md`);
   `/start status` shows where you are. `/today` shows only today's growth task once the site is live.

Requirements: Node `>=24.22.0 <25` (see `package.json` → `engines`), npm 11+, Git. Python and `pipx` only if you enable
the Google Analytics MCP server.

### Choose your technology: Next.js or anything else
The purpose of this repository is to build **websites**, in whatever technology you choose. `/start` asks on every new
copy:

| You choose | What happens |
|---|---|
| **Next.js** | The built-in starter (`docs/TODO-step-c.md` §1): static export to `out/`, the shipped commands, ready to fill. |
| **Another technology** (Astro, Eleventy, Hugo, Vite, SvelteKit, Remix, …) | The architect sets its build and dev commands and output folder in `factory.config.json` → `build`, lists the npm packages it needs (supply-chain checklist), and the coder builds the site in it. The build command ends with `node scripts/gen-public-files.mjs --after-build`, which writes `sitemap.xml` and `llms.txt` from the pages it built. |
| **Not sure** | The architect recommends one at the architecture stage, from what your keyword map needs, and you decide. |

Whatever you pick, the rest stays the same: the agents, keyword pipeline, content and SEO rules, security checks,
AdSense gate, budgets and CI. `npm run build` and `npm run dev` run your technology through `scripts/framework.mjs`,
and every check reads the site from `build.outputDir`. Every page must still be crawlable HTML (static or
server-rendered, never client-only). A technology that can't run on a free plan (for example PHP with a database
server) is a stop-and-ask: the agent names the cost and offers a free alternative.

---

## 3. What you provide
| Input | Where | Notes |
|---|---|---|
| Domain, brand, markets, **technology** | `/start` writes them to `factory.config.json` | Technology: Next.js (built-in starter) or any other (§2). |
| Competitors and their **DR** | `research/inputs/competitors.csv` (`domain,dr,notes,brands`) | You supply DR from a tool you already use; agents never look it up (it's a paid metric, and free checkers sit behind CAPTCHAs). The lowest DR becomes the seed. |
| **Google Keyword Planner exports**, one per competitor | `research/inputs/kp/<competitor-domain>.csv` | Keyword Planner's own `.csv` (UTF-16, tab-separated) or a CSV UTF-8 re-save. **Excel `.xlsx` is refused**: save as CSV. Use the last 12 full months, so the 12 monthly columns exist. Step-by-step export guide: `research/inputs/README.md`. |
| Keyword difficulty (optional but needed for selection) | `research/inputs/kd.csv` (`keyword,kd,source,checked`) | From the free SERP check or your own tool. Keywords without a KD wait in `research/out/kd-todo.csv`. |
| Category fixes (optional) | `research/inputs/categories.csv` | For clusters left as `uncategorized`. |

Fake sample inputs live in `research/inputs/examples/` (never read by the pipeline).

---

## 4. The pipeline
`/start` runs these stages in order. Each has an owner, an output, and a gate in `.claude/skills/gate/stages.json`.

| # | Stage | Agent | Output | Decided by |
|---|---|---|---|---|
| 1 | intake | orchestrator | `factory.config.json`, `research/inputs/competitors.csv` | `gate.mjs intake` (prints the seed) |
| 2 | recon | competitor-recon | `research/out/recon/<competitor>.md` | recon files exist; unique-text check finds no copied text |
| 3 | keywords | keyword-researcher | `keywords.json`, `selected.json`, `keyword-map.json` | `npm run research:all` (exits 1 on any rule break) |
| 4 | strategy | content-strategist | `docs/CONTENT-STRATEGY.md`, content plan, briefs, JSON-LD plan | briefs for wave 1 exist; schema plan per page type |
| 5 | growth | growth-strategist | `docs/GROWTH-90.md`, `growth/plan.json` | plan validates (one task a day, ≤ 45 min, a done check each) |
| 6 | architecture | architect | `docs/ARCHITECTURE.md`, `hosting.target` | Pages vs Workers rule applied (§10) |
| 7 | design | designer | `docs/DESIGN.md` | `npm run gate:design` (WCAG AA contrast); fonts self-hosted |
| 8 | build | coder | the site | `npm run verify` |
| 9 | tests | harness | `tests/**` | `npm test`, `npm run test:e2e`, in CI too |
| 10 | code-review | code-reviewer | `reports/code-review.md` | Verdict PASS with 0 blockers, for the current commit (`gate.mjs code-review`) |
| 11 | reconcile | reconciler | `reports/reconcile.md` | keyword map ↔ pages ↔ design ↔ briefs agree |
| 12 | seo | seo-auditor | `reports/seo.md` | `check-out` in the build |
| 13 | ai-search | ai-search-auditor | `reports/ai-search.md` | `llms.txt` and `robots.txt` follow the bot policy (`gate.mjs ai-search`) |
| 14 | adsense | adsense-gatekeeper | `reports/adsense.md` | `npm run gate:adsense` |
| 15 | security | secops-reviewer | `reports/security.md`, `docs/SECURITY.md` | §9 checks |
| 16 | responsive | responsive-checker | `reports/responsive.md` | e2e at 320–1280 px |
| 17 | performance | performance-auditor | `reports/performance.md` | Lighthouse and Core Web Vitals budgets (§11) |
| 18 | preprod | orchestrator | — | `preprod.yml` green on the PR to the production branch |
| 19 | cloudflare | cloudflare-reviewer | `reports/cloudflare.md` | only when hosting is Cloudflare; free-plan checklist |
| 20 | go | **you** | — | your GO for that exact commit, typed in chat |
| 21 | deploy | devsecops-deployer | — | deploy workflow, then `check:live` |
| 22 | docs | doc-generator | `docs/PRD.md`, `DESIGN.md`, `ARCHITECTURE.md`, `SECURITY.md` | regenerated from the agents' outputs |

Every gate run is recorded in `reports/ledger.md` (format in `AGENTS.md` §5), so any session can resume.

---

## 5. The agents
All 20 live in `.claude/agents/`; `AGENTS.md` §2 has the full map.

| Agent | Job | Main skills and tools |
|---|---|---|
| orchestrator | Runs `/start`: intake, stage order, gates, ledger | `/goal`, gate runner |
| competitor-recon | Maps competitors' public sites: page types, URLs, templates, stack, a feature matrix across competitors, what their readers complain about, UX gaps | `replica-recon`, `replica-architect`, `replica-diff`, `replica-entrepreneur`, marketingskills `competitors`, Playwright MCP, rea website tools (optional) |
| keyword-researcher | Keyword Planner CSVs → selected keywords → keyword map | the Step B scripts, `keyword-research`, `serp-analysis`, claude-seo `seo-cluster`, `programmatic-seo` |
| content-strategist | Content plan, page briefs with voice notes, JSON-LD and schema plan, `llms.txt` | marketingskills `content-strategy`/`copywriting`/`schema`/`ai-seo`, claude-seo `seo-content-brief`/`seo-geo`/`seo-schema`, `humanizer` |
| growth-strategist | The 90-day ADHD-friendly growth plan (§12) | marketing-loops, marketing-ideas, marketing-council (Hormozi lens), customer-research |
| architect | Static or server code; Cloudflare Pages or Workers; URL and internal-link plan; `ARCHITECTURE.md` | `site-architecture`, `site-structure-optimizer`, claude-seo `seo-sitemap`/`seo-programmatic`, Anthropic feature-dev `code-architect`, `codebase-design`, `writing-plans`, Cloudflare skills, Cloudflare docs MCP |
| designer | Visual identity as `DESIGN.md`: palette, SEO-friendly fonts, components, motion; UI/UX gaps vs competitors | **ui-ux-pro-max**, Vercel `web-design-guidelines` (pinned rules), `accessibility`, **awesome-design-md** (reference), **design.md** format, `replica-design` |
| coder | Builds pages and their text from the keyword map, briefs and `DESIGN.md` | anthropics `frontend-design`, Vercel `react-best-practices` (Next.js) and `composition-patterns`, `copywriting`, `copy-editing`, `humanizer`, `verification-before-completion`, Cloudflare skills |
| harness | Unit and e2e tests with a planted failing case per gate; wires them into CI | superpowers `test-driven-development`, `systematic-debugging`, `verification-before-completion`; `@playwright/test`, Playwright MCP |
| code-reviewer | Reviews every diff before a PR: your rules, correctness, silent failures, tests, security regressions; fixes nothing | Anthropic pr-review-toolkit agents, superpowers `requesting-code-review`, Trail of Bits `differential-review`, `codebase-design` |
| reconciler | Cross-checks keyword map, pages, design and briefs; parity vs competitors | `replica-diff` |
| seo-auditor | On-page and technical SEO; prose that reads as human | marketingskills `seo-audit`, claude-seo suite, `humanizer` |
| ai-search-auditor | AEO and GEO: AI crawlers, `llms.txt`, answer-first passages, entities, dates and sources | marketingskills `ai-seo`/`schema`, claude-seo `seo-geo` |
| adsense-gatekeeper | GO / NO-GO against AdSense policies; scans the codebase for required pages and forbidden code | `gate:adsense` |
| secops-reviewer | All §9 security checks; supply-chain review of every skill or action before use | Trail of Bits `semgrep`/`supply-chain-risk-auditor`/`agentic-actions-auditor`/`differential-review`, GitHub awesome-copilot `github-actions-hardening`/`security-review`, `security-and-hardening`, gitleaks, ZAP, `check:skills` |
| cloudflare-reviewer | Free-plan Cloudflare checklist; only when you choose Cloudflare | Cloudflare MCP (reads; every write needs your yes) |
| responsive-checker | Every page type from 320 to 1280 px | Vercel `web-design-guidelines` (pinned rules), Playwright |
| performance-auditor | Lighthouse and Core Web Vitals budgets | `core-web-vitals`, `accessibility`, Cloudflare `web-perf`, Lighthouse CI, Chrome DevTools MCP |
| devsecops-deployer | Pre-prod checks on the production branch → your GO → deploy → live check → rollback | Cloudflare `wrangler`, wrangler-action, `deploy-production` skill |
| doc-generator | Writes PRD, DESIGN, ARCHITECTURE and SECURITY docs that any agent can read | `docs/templates/`, `copy-editing`, `humanizer` |

---

## 6. Skills, trusted sources and MCP servers
**Project skills** (`.claude/skills/`):

| Skill | Does |
|---|---|
| `/start` | Runs or resumes the pipeline (§4) |
| `/today` | Shows only today's growth task and your streak |
| `/gate` | Runs a stage's gate: `node .claude/skills/gate/gate.mjs <stage>` or `status` |
| `/keyword-pipeline` | Runs ingest → select → cluster with explanations |
| `/deploy-production` | The deploy loop: gates, your GO, deploy, live check, rollback |

**Trusted sources** (`skills.lock.json`, explained in `docs/SKILLS.md`): every external skill, plugin, MCP server and
GitHub Action, with its tier, licence, purpose, the agents that use it, and a pinned commit.

**Vendored skills** (`vendor/skills/<name>/`): the 46 external skills the agents use, plus one pinned rules file. Each
is copied byte for byte from a reviewed commit at least 7 days old, with the sha256 of every file in the lock. Agents
read them by path, so a personal skill of the same name or a newer upstream version can't change what they follow.
`npm run check:skills` (CI and `verify`) fails on any changed, extra or missing file, hidden Unicode, a missing licence,
an unapproved source or an agent naming an unlocked skill. `docs/SKILLS.md` lists the skills by agent and how to add one.

| Tier | Sources |
|---|---|
| Official | `anthropics/skills`, `anthropics/claude-plugins-official` (the `pr-review-toolkit` and `feature-dev` agent prompts; `claude-security` is proprietary and not used), `cloudflare/skills`, `vercel-labs/agent-skills`, `vercel-labs/web-interface-guidelines`, Cloudflare MCP servers, `github/github-mcp-server`, `microsoft/playwright-mcp`, `ChromeDevTools/chrome-devtools-mcp`, `googleanalytics/google-analytics-mcp`, `GoogleChrome/lighthouse-ci`, `cloudflare/wrangler-action`, gitleaks, Semgrep, ZAP actions, `actions/*` |
| Security firm | `trailofbits/skills` |
| Community (reviewed, then pinned) | `coreyhaines31/marketingskills`, `AgriciDaniel/claude-seo`, `aaron-he-zhu/aaron-marketing-skills`, `blader/humanizer`, `nextlevelbuilder/ui-ux-pro-max-skill`, `github/awesome-copilot`, `obra/superpowers`, `mattpocock/skills`, `addyosmani/agent-skills`, `addyosmani/web-quality-skills`, `VoltAgent/awesome-design-md`, `google-labs-code/design.md` |
| Caution | `Jakeschincariol/replica-skill` (young project; structure, parity and reader research only), `morluto/rea` (website tools only, approved by the owner with limits; `docs/MCP.md`) |
| Excluded | `getsentry/skills` (failed its skills.sh audit, 2026-10-28), `searchfit/searchfit-seo`, `affaan-m/ECC`, `AThevon/genjutsu`, `every-app/open-seo`, `aaron-he-zhu/seo-geo-claude-skills`, `zacker-tech/hormozi-skills`, `mrgoonie/claudekit-skills` (reasons in `docs/SKILLS.md`) |

Star counts and install counts are not treated as proof of safety. Every skill is found through Skillselion and must
pass its skills.sh audit (3/3, or 2/3 where the only finding is Snyk's W011, "reads web pages"); anything else needs
your recorded exception (`docs/SKILLS.md`). Anything not in the lock needs your yes, after the secops-reviewer checks it.

**MCP servers** (`.mcp.json`, explained in `docs/MCP.md`): free; all official except `rea`, which you approved with limits.
- `cloudflare-docs`, `cloudflare-api`: reads are free; every write asks you; deletes are refused.
- `github`: read-only.
- `playwright`, `chrome-devtools`: local headless browsers.
- `google-analytics`: read-only, after launch.
- `claude-docs`.
- `rea` (`rea-agents@6.5.0`): competitor-recon's six website tools only, attached to a throwaway Chrome profile you
  start (`docs/MCP.md` → rea); optional.

Listed but off because they're paid: Semrush, Ahrefs, DataForSEO, Claude in CI. There's no official Google Search
Console MCP server, so that step stays manual.

---

## 7. Keyword research rules
Implemented in `scripts/research/` (Step B). Each script exits 1 with a message when a rule breaks.

| Rule | How |
|---|---|
| **Keyword difficulty is real KD** | From `kd.csv` (free SERP check or your tool). Keyword Planner's "Competition" measures **advertiser bidding**; it's stored as `competitionAds`, never used as KD. |
| **Volume** | At least `research.minVolume`. Bucketed volumes like `1K – 10K` (accounts without ad spend) are stored as ranges [R], never as fake exact numbers. |
| **Low difficulty** | KD ≤ `research.maxKd`. No KD → queued in `kd-todo.csv`, not selected. |
| **Not seasonal** | Seasonality = peak month ÷ median month over the 12 monthly columns. Above `research.maxSeasonality` → rejected as a seed. |
| **No brand terms** | Keywords naming a competitor's brand are rejected. |
| **One owner per keyword** | Every selected keyword belongs to exactly one URL, or is listed in `discarded[]` with a reason. |
| **No keyword stuffing** | At most `research.maxSecondaryKeywordsPerPage` secondary keywords per page. |
| **No cannibalization** | Two URLs can't share a primary keyword. |
| **Intent decides the page type** | tool, calculator, generator, converter → tool page; how, what, why, cost, chart → guide under its tool. |

The thresholds in `factory.config.json` are starting defaults [P], not research results: tune them per project.

---

## 8. Content, SEO and crawler rules
- **URLs:** `/{category}/{slug}/` for tools and hubs, `/{category}/{slug}/{child}/` for guides and programmatic
  instances; lowercase, trailing slash, at most 3 levels deep; breadcrumbs mirror the URL.
- **Length:** tool pages 600–1,500 words of unique text; guides 800–1,500; hubs ≥ 300 words in `<main>`; trust pages
  ≥ 200. These are floors, never targets; never pad.
- **Keyword stuffing and thin pages are build failures:**
  - every build runs the on-page SEO gate (`scripts/audits/seo-checks.mjs`, 169 checks per page, `docs/SEO-GATE.md`);
  - a target term over 6% of a page's meaningful words fails; titles must be 30–60 characters with the URL's words;
  - cut repetition by naming the task ("fractions, gravel orders"), never with vague swaps such as "tools".
- **Programmatic SEO** only for keyword families with demand evidence (Google's scaled-content-abuse policy).
- **Structured data:** JSON-LD per page type (WebPage, WebApplication, BreadcrumbList, FAQPage, Article,
  CollectionPage, Organization, WebSite); no self-made ratings. `llms.txt` is generated too (cheap and optional; there's
  no evidence Google uses it).
- **Crawlers** (`factory.config.json` → `bots`, written into `robots.txt`):
  - **allowed:** Googlebot, Bingbot, `AdsBot-Google`, and `Mediapartners-Google` (AdSense's crawler ignores `*`, so it
    gets its own line);
  - **allowed AI search bots:** `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`;
  - **AI training bots** (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`): your choice (`aiTraining`), enforced with
    Cloudflare AI Crawl Control (free), since robots.txt is only a request.

  Blocking Googlebot or Bingbot would remove the site from search, and "Gemini" isn't a crawler: AI Overviews use
  Googlebot.

---

## 9. Security checks
Run by the secops-reviewer locally (`npm run check:security`), and in `security.yml` / `preprod.yml`. Probes only target
this project's own preview or production hosts.

| Check | How (free) | Fails when |
|---|---|---|
| Attack scan (Burp-style) | **ZAP by Checkmarx**: baseline scan on every preview, full scan weekly and before releases. Burp Suite's automated scanner is Professional-only (paid). | A medium or high alert that isn't a reviewed exception (`.github/zap/rules.tsv`) |
| XSS | CSP test; ESLint `no-unsanitized`; `dangerouslySetInnerHTML` only in the JSON-LD component; `</script>` escaping test; payloads injected into every allowed query parameter | A payload runs or appears unescaped |
| CSRF | Static site: no endpoint accepts POST. With server code or forms: Origin/Referer check, `SameSite` cookies, CSRF token or Turnstile, and a cross-origin POST test | A cross-origin POST succeeds |
| Path traversal | Live probes (`/..%2f..%2fetc/passwd`, `/%2e%2e/`, `/..;/`, double-encoded, backslash); Semgrep rules on any server code | Anything other than 400/404 without file contents |
| Rate limiting | A short capped burst against your own preview. Endpoints need Cloudflare's free rate-limiting rule and return `429` | An endpoint keeps answering 200 |
| Private server URL exposure | Scans the build output folder (`build.outputDir`), bundles and source maps for private IPs, `localhost`, internal hosts, preview URLs, keys and tokens; checks headers for `x-powered-by`/version leaks; DNS for unproxied origin records | Any match |
| Served only through Cloudflare | Every response has `server: cloudflare` and `cf-ray`; every web hostname proxied; all resources same-origin or CSP-allowed | Anything bypasses Cloudflare |
| Email spoofing | SPF (`-all` plus null MX if the domain never sends mail), DKIM when mail is used, DMARC ramped `none → quarantine → reject` on a dated schedule | SPF/DKIM/DMARC missing, or DMARC stuck at `none` past its review date |
| Secrets and supply chain | gitleaks (full history and the build output folder), `npm audit` gate, `npm audit signatures`, Semgrep, actions pinned to commit SHAs, `.npmrc` (no install scripts, exact versions, 7-day minimum release age) | A finding |

Each check gets a planted failing case in its tests, to prove it fails when it should.

---

## 10. CI/CD and deployment
Full details, secrets and variables: `.github/CI-CD.md`.

| Workflow | Runs on | What it does |
|---|---|---|
| `ci.yml` | every PR and push to `main`; called by the deploys | **always:** unit tests and helper self-tests. **Once a project exists:** check:repo → audit → lint → typecheck → build → e2e |
| `security.yml` | PRs, pushes, weekly, preview deployments | gitleaks, npm audit gate and signatures, Semgrep, ZAP baseline (previews) and full scan (weekly) |
| `lighthouse.yml` | PRs and pushes, once a project exists | builds, serves the output folder, runs Lighthouse CI against the budgets |
| `preprod.yml` | PRs to the production branch | every gate plus `check:security` and ZAP against the PR's preview |
| `deploy-pages.yml` | by hand, or on a push to `main` with `AUTO_DEPLOY` | only if `hosting.target` is `cloudflare-pages`: the CI gates on that exact commit, then build, `wrangler pages deploy`, `check:live` |
| `deploy-workers.yml` | same | only if `hosting.target` is `cloudflare-workers`: the CI gates on that exact commit, then build, `wrangler deploy`, `check:live` |
| `live-check.yml` | daily | `check:live` and `check:security` against `LIVE_SITE_URL` |
| `dependabot.yml` | weekly | grouped npm and Actions updates with a 7-day cooldown |

**Hosting rule:** Cloudflare **Pages** for a static export (the default); Cloudflare **Workers** static assets when the
app needs server-side code. Both on the free plan. The architect suggests the target; you confirm. Other hosts can be
added (`hosting.options` includes `other`).

**Secrets:** `CLOUDFLARE_API_TOKEN` (scoped, with an expiry) and `CLOUDFLARE_ACCOUNT_ID`. **Variables:**
`LIVE_SITE_URL`, `LIVE_PAGES_HOST`, and optional `AUTO_DEPLOY`.

**Public vs private repository** (checked on docs.github.com, 2026-10-25 [M]): on a **private** repo with GitHub Free
you get **no environments, no required reviewers, no environment secrets, no protected branches, and no CodeQL,
dependency review or secret scanning**. So:
- Keep the template **public** to get them free.
- On a private repo, keep `AUTO_DEPLOY` unset and deploy only by hand: clicking Run workflow is then your GO.

---

## 11. Quality budgets
From `factory.config.json` → `budgets`:
- **Lighthouse:** Accessibility, Best Practices and SEO = **100**; Performance **≥ 90** on mobile (before ads; ads lower
  it, and lab scores vary between runs, so a flat 100 isn't a stable gate).
- **Core Web Vitals** (what Google ranks on): LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.

---

## 12. The 90-day growth plan (ADHD-friendly)
Written by the growth-strategist into `docs/GROWTH-90.md` and `growth/plan.json`:
- **Daily:** one task, 25–45 minutes, with a clear "done when".
- **Weekly:** a theme; Monday planning and Friday review take 10 minutes each.
- **No overload:** at most 3 open items, plus a parking lot for new ideas.
- **`/today`:** shows only today's task and your streak. An optional local reminder can use Claude's scheduled tasks
  (free).

It uses the marketing skills (marketing-loops, marketing-ideas, customer-research) and the marketing-council's Hormozi
lens for offers and distribution ideas.

---

## 13. npm scripts
The names are frozen in `docs/CONTRACT.md`. Every script exists; ⛔ marks the one that can't run yet.

| Script | Does | State |
|---|---|---|
| `research:ingest` / `research:select` / `research:cluster` / `research:all` | The keyword pipeline (§7) | ✅ |
| `dev`, `build`, `serve` | Dev server and production build in **your chosen technology** (`scripts/framework.mjs` runs `build.commands`; the build adds `production-gate`, `check-out` and the SEO gate), local static server for `build.outputDir` | ✅ |
| `lint`, `typecheck`, `test`, `test:e2e` | ESLint, TypeScript, Vitest, Playwright | ✅ (`lint` reads the code through TypeScript 6's API, §1) |
| `check:repo`, `check:release`, `check:live`, `check:security` | Repo hygiene, publish gate, live-site check, security checks | ✅ (`check:release` fails on the template by design: example pages, no briefs) |
| `audit:seo`, `check:seo-live` | The on-page SEO gate on the build output (also run by `build`), and its live checks against a URL (`docs/SEO-GATE.md`) | ✅ (`audit:seo` needs a build) |
| `audit`, `audit:perf`, `audit:a11y`, `audit:unique`, `audit:ga`, `audit:lighthouse` | CVE gate, lab speed, accessibility, duplicate text, GA4 privacy, Lighthouse CI | ✅ (`audit:ga` skips without a GA4 ID; `audit:lighthouse` runs a pinned `npx @lhci/cli@0.15.1`) |
| `gate:adsense`, `gate:design` | AdSense gate, contrast gate | ✅ (NO-GO on the template's example pages; `gate:design` reads `docs/DESIGN.md`, written at the design stage) |
| `growth:today` | Today's growth task | ✅ (reads `growth/plan.json`, written at the growth stage) |
| `verify` | check:repo → audit → lint → typecheck → test → build → test:e2e | ✅ (on the bare template, with `SITE_URL=https://example.com`) |

---

## 14. Repository map
```
aksitekit/
├── CLAUDE.md                rules for every agent
├── AGENTS.md                agent map, pipeline, gate table, ledger format, project status
├── README.md                this file
├── factory.config.json      project inputs, hosting, research thresholds, bot policy, budgets, paid tools (off)
├── skills.lock.json         trusted sources, pinned to commits
├── .mcp.json                official, free MCP servers
├── .npmrc                   supply-chain rules (no install scripts, exact versions, 7-day minimum age)
├── .claude/
│   ├── agents/              20 agents
│   ├── skills/              start, today, gate (+ gate.mjs, stages.json), keyword-pipeline, deploy-production
│   ├── hooks/               secret and .env guard, push guard, secret scan after edits
│   └── settings.json        permissions and hooks
├── .github/
│   ├── workflows/           ci, security, lighthouse, preprod, deploy-pages, deploy-workers, live-check
│   ├── scripts/             target-host guard, ZAP gate, preview-URL finder, self-tests
│   ├── zap/rules.tsv        reviewed ZAP exceptions
│   ├── dependabot.yml
│   └── README.md            CI/CD details, secrets, variables, private-repo caveats
├── app/, components/, lib/  the Next.js starter: page templates, trust pages, JSON-LD, consent, the example tool
├── content/                 site facts (site.json), page text (pages/*.json), the example keyword map (examples/)
├── scripts/                 the gates (production-gate, check-out, check-repo, audit, check-live, check-security,
│                            adsense-gate), public files, the local server, design/, growth/, audits/, lib/
├── tests/                   unit tests with a planted failing case per gate; e2e/ for Playwright
├── research/
│   ├── inputs/              your files (competitors.csv, kp/*.csv, kd.csv) + README export guide + fake examples
│   └── out/                 generated keywords, selection, keyword map
├── scripts/research/        ingest, select, cluster
├── tests/research/          55 pipeline tests
├── docs/
│   ├── BLUEPRINT.md         the approved design
│   ├── CONTRACT.md          file ownership, npm scripts, data formats
│   ├── TODO-step-c.md       starter website and gates: what's built, what's blocked
│   ├── SKILLS.md, MCP.md    trusted sources and MCP servers explained
│   └── templates/           PRD, DESIGN, ARCHITECTURE, SECURITY, CONTENT-STRATEGY, GROWTH-90
└── growth/                  90-day plan data (generated)
```

---

## 15. Rules for agents
The full list is in `CLAUDE.md`. The essentials:
- Free tools only; ask before anything paid, and offer a free alternative if you say no.
- Gates decide; never loosen a gate to get green. Record every gate run in the ledger.
- Trusted sources only, pinned to commits.
- Never commit or push to `main`, and never deploy without your GO for that exact commit.
- Never copy competitors' text, images, code or design; recon is for structure and UX gaps only.
- Never scrape Google, bypass CAPTCHAs, or fetch paid metrics such as DR.
- No AdSense code or `ads.txt` before the AdSense gate passes and your account is approved.
- Never invent facts, sources, reviews or metrics. Label numbers [M] measured, [R] range, [P] estimate, [U] unverified.
- New npm dependencies need the supply-chain checklist and a version at least 7 days old.

---

## 16. Research corrections built in
| Common assumption | What's true (checked 2026-10-25) | What the template does |
|---|---|---|
| Keyword Planner shows keyword difficulty | Its "Competition" is advertiser bidding (Google Ads API docs) | KD from the free SERP check or your tool |
| Agents can fetch competitor DR | DR is a paid Ahrefs metric; free checkers use CAPTCHAs | You supply DR |
| Only ChatGPT, Gemini and Claude should crawl | That would drop Google and Bing; AdSense needs its own crawler line | Search, AdSense and AI-search bots allowed; training bots optional |
| Lighthouse 100 everywhere | Lab scores vary; ads lower Performance; Google ranks on field data | 100 on A11y/BP/SEO, ≥ 90 Performance, CWV limits |
| Burp Suite in CI | Its automated scanner is paid | ZAP (free, official actions) |
| Excel keyword files | Excel parsers have a poor security record on npm | CSV/TSV only |
| Claude agents run in CI | Needs a paid API key | CI runs free scripts; agents run locally |
| Cloudflare Pages for everything | Cloudflare now points new server-side projects to Workers | Pages for static, Workers for server code |

---

## 17. Honest limits
- No check can guarantee AdSense approval or rankings; Google decides both.
- DR and keyword difficulty come from you or a paid tool; the template ships neither.
- In template mode CI checks only what exists (tests, helper self-tests, secret and code scans); the site jobs start once
  a project exists.
- The starter website is generic on purpose: its example pages describe the kit itself and are replaced at the build
  stage, and each project's look comes from its designer stage.
- `npm run lint` reads the code through TypeScript 6's API until typescript-eslint supports TypeScript 7.1; then the
  `typescript` alias goes (§1).
