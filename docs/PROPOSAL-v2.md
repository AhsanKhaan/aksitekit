# Proposal: AK Site Kit v2, with the evidence

Status: **approved by the owner on 2026-10-28** (the recommended plan: the "3/3, or 2/3 with only W011" rule, and
sections 5 and 6 as separate pull requests). Data was collected on 2026-10-27; every number is labelled **[M]**
measured (source named), **[P]** proxy or estimate, or **[U]** unverified.

**What changed while building it:**
- **Section 5 is built** (pull request `feat/v2-skills-agents`). The details are in `docs/SKILLS.md` → "Findings from
  the 2026-10-28 review".
- **`claude-security` was dropped.** Its licence turned out to be proprietary ("All rights reserved", no
  redistribution), so it fails the open-source rule. `secops-reviewer` gets `security-review`,
  `github-actions-hardening` and `differential-review` instead.
- **The optional skills weren't added,** because they weren't explicitly approved: `kostja94` GEO and
  `julianoczkowski` design tokens.
- **Section 6 waits for two owner decisions:** the licence (MIT or Apache-2.0) and whether the repository goes public.

## 1. The short answer
The current strategy is already ahead of common practice on the part that matters most: how skills reach the agents.
Skills are vendored, pinned to commits at least 7 days old, and hash-checked in CI. That is exactly the defence against
the attacks seen in the wild (section 3). What it lacks is:
- **A security score per skill.** 25 of the 46 vendored skills pass all three skills.sh scanners. 16 more fail only one
  generic check that every web-reading skill gets. 5 have real findings, and 2 of those have better replacements.
- **The roles you asked for:** a code reviewer, a separate AEO/GEO auditor, and stronger security and architecture
  agents. There are official Anthropic agents and 3/3 skills for each.
- **The open-source basics** that OpenSSF Scorecard measures: a licence, a security policy, branch protection, SBOM and
  provenance.

So v2 should **add** to the current strategy, not replace it. A **strict** 3/3 rule would remove every SEO-audit skill:
none of the 4 checked passes 3/3 (section 4).

## 2. Method
1. **Discovery with Skillselion** (`skillselion-mcp@0.9.11`, `search_skillselion` and `top_skillselion`). One search
   per role: code review, security review, GitHub Actions security, supply chain, threat modelling,
   technical SEO, GEO, AEO, schema, UI/UX, accessibility, performance, Next.js, Cloudflare, Playwright, architecture,
   DevSecOps, AdSense, content writing, orchestration, TDD, verification, `llms.txt`, Core Web Vitals and design tokens.
   `load_skill` and `synthesize_skills` were not used (section 7).
2. **Security score:** skills.sh runs three scanners on each skill: **Gen Agent Trust Hub**, **Socket** and **Snyk**.
   Skillselion shows the same result on each skill page ("Security audit 2 / 3 scanners passed — skills.sh audit"
   [M: skillselion.com, seo-audit page]). This is the "3/3" score. For every skill that wasn't 3/3, I read the scanner's
   detail page.
3. **Source facts** (licence, owner type, stars, last push) came from the GitHub API [M]. For the official Anthropic
   agents, I read their files and READMEs [M].

## 3. Facts behind the decision
| # | Fact | Source | What it means for us |
|---|---|---|---|
| F1 | Snyk scanned **3,984** skills from ClawHub and skills.sh. **13.4%** (534) had at least one critical issue, **36.82%** (1,467) had at least one flaw, and **76** carried confirmed malicious payloads | [M] Snyk ToxicSkills, 2026-02-05 | Installing skills unreviewed is a real risk. Vendoring plus review is the right default |
| F2 | **2.9%** of ClawHub skills fetch and run remote content at runtime | [U] attributed to the same study by secondary sources; not found on Snyk's page | A skill loaded fresh from the internet on each run is the exact pattern the study flags |
| F3 | Skillselion ranks by installs and stars. Its leaderboard lists `reddit-automation` with **1,116,862 installs and 3 stars** | [M] `top_skillselion`, 2026-10-27 | Installs can be inflated. Popularity is not trust, so the security score and our own review must decide |
| F4 | Skillselion search missed official sources in this test. `cloudflare` didn't return `cloudflare/skills`, and `nextjs` didn't return Vercel's skills. The top `code review` hit had **9 installs** | [M] `search_skillselion`, 2026-10-27 | Skillselion is a good discovery tool, but it can't be the only source |
| F5 | Snyk's **W011** check means "third-party content exposure (indirect prompt injection risk)", rated low risk 0.10 on SEO skills. It fires on any skill that reads web pages | [M] skills.sh detail pages for `seo-audit`, `seo-technical` and 13 others | Every SEO or competitor skill gets it, because an SEO auditor has to read web pages. Our rule that fetched text is data, never instructions (AGENTS.md → Skills), is the control for it |
| F6 | The official `claude-security` plugin maps the architecture, builds a threat model, has independent verifiers try to disprove every finding, and writes Markdown, JSONL and **SARIF 2.1.0** reports. It runs inside your Claude Code session, with no separate API key | [M] `anthropics/claude-plugins-official` README | A real upgrade for `secops-reviewer`. It uses your Claude plan's usage, not money |
| F7 | Claude Code plugin sources can be pinned to a git `ref` or `sha` | [M] code.claude.com, plugin marketplaces docs | Official agents can be pinned the same way our skills are |
| F8 | OpenSSF Scorecard checks for a licence file, `SECURITY.md`, branch protection, code review, SAST, SBOM, signed releases, pinned dependencies and token permissions. Its SAST check detects **CodeQL and SonarCloud**, not Semgrep | [M] `ossf/scorecard` docs/checks.md | We already pass pinned dependencies, token permissions and dependency updates. We miss licence, security policy, SBOM and signed releases |
| F9 | Code scanning (CodeQL) on a **private** repository needs a paid GitHub Code Security licence | [M] GitHub docs, "About code scanning" | `AhsanKhaan/aksitekit` is private (the public API returns Not Found [M]). CodeQL becomes free only after the repo is made public, which open-sourcing does |

## 4. The current 47 vendored skills, scored
`web-interface-guidelines` is a pinned rules file, not a skill, so skills.sh doesn't score it. That leaves **46** to
score.

**3/3 (25) [M]:** `frontend-design`, `workers-best-practices`, `wrangler`, `supply-chain-risk-auditor`, `ui-ux-pro-max`,
`reverse-engineer-anything`, `seo-geo`, `seo-programmatic`, `ai-seo`, `competitors`, `copy-editing`, `copywriting`,
`marketing-ideas`, `programmatic-seo`, `schema`, `site-architecture`, `replica-architect`, `replica-design`,
`replica-diff`, `security-and-hardening`, `site-structure-optimizer`, `react-best-practices`, `accessibility`,
`core-web-vitals`, `humanizer`.

**2/3, where the only finding is Snyk W011, reads web pages (16) [M]:** `web-perf`, `semgrep` (risk 0.30: it clones
third-party rule repositories), `seo-audit`, `seo-technical`, `seo-cluster`, `seo-content`, `seo-content-brief`,
`seo-schema`, `seo-sitemap`, `content-strategy`, `customer-research`, `marketing-council`, `marketing-loops`,
`replica-recon`, `replica-entrepreneur`, `serp-analysis`.

**Real findings (5) [M]:**
| Skill | Score | What the scanners found | Proposal |
|---|---|---|---|
| `gha-security-review` (Sentry) | 1/3 | Trust Hub **Fail, CRITICAL**: its reference files hold real attack payloads (`curl \| bash`, Base64 obfuscation, a known malicious domain, credential theft steps). Socket: 2 MEDIUM alerts | **Replace** with `github/awesome-copilot` → `github-actions-hardening` (3/3, MIT, GitHub's own org, 40,471 stars [M]) |
| `webapp-testing` (Anthropic) | 1/3 | Socket LOW: `scripts/with_server.py` runs commands with `shell=True`. Plus Snyk W011 | **Replace for discipline** with `obra/superpowers` → `test-driven-development` (3/3) and `verification-before-completion` (2/2; Socket hasn't scored it). The harness keeps using `@playwright/test` directly. No 3/3 Playwright skill was found: `playwright-cli` scored 1/3, `agent-browser` 2/3 [M] |
| `keyword-research` (aaron-marketing-skills) | 1/3 | Trust Hub WARN: helper scripts `suggest.py` and `firecrawl.py` take user input on the command line. Plus Snyk W011 | **Keep, with a recorded exception:** our vendored copy already leaves those scripts out (docs/SKILLS.md, finding 9). No 3/3 skill with an equal method was found |
| `agentic-actions-auditor` (Trail of Bits) | 2/3 | Socket LOW anomaly in an attack-vector reference file | Keep (security-firm tier; documentation of attacks) |
| `web-design-guidelines` (Vercel) | 2/3 | Socket LOW "system prompt extraction" anomaly, scanned on a March 2026 version that fetched its rules live | Keep: we already read a pinned rules file instead of fetching (docs/SKILLS.md, finding 3) |

**What a strict 3/3 rule would cost:** it would remove 21 skills, including every SEO-audit skill. The 3/3 alternatives I
checked all score 2/3 because of W011: `coreyhaines31/seo-audit`, `AgriciDaniel/seo-technical`,
`anthropics/knowledge-work-plugins/seo-audit` and `squirrelscan/audit-website` [M]. **Recommended rule:** 3/3, or 2/3
when the only finding is W011 and the agent file says fetched content is data. Anything else needs an exception
recorded in `docs/SKILLS.md`.

## 5. Proposed agents (18 → 20) and the skills each would add
Every new skill below is **3/3 [M]** unless marked. Each still goes through `docs/SKILLS.md`: newest commit at least 7
days old, file-by-file review, then vendored and hashed.

| Agent | Change | Adds | Source facts [M] |
|---|---|---|---|
| **`code-reviewer`** (new, #19) | Reviews every diff before a PR, against CLAUDE.md, with few false positives | Agents: official `pr-review-toolkit` (`code-reviewer`, `silent-failure-hunter`, `pr-test-analyzer`, `type-design-analyzer`), pinned by sha. Skills: `requesting-code-review` (obra/superpowers), `differential-review` (trailofbits), `codebase-design` (mattpocock) | Anthropic official, Apache-2.0. superpowers MIT, 306,232 stars. mattpocock/skills MIT, 304,748 stars. trailofbits CC-BY-SA-4.0 |
| **`ai-search-auditor`** (new, #20: AEO/GEO) | Split out from `seo-auditor`: AI-crawler access per `bots`, `llms.txt`, passage citability, answer blocks, entity clarity | `ai-seo`, `seo-geo`, `schema` (already vendored, all 3/3). Optional: `kostja94/marketing-skills` → `generative-engine-optimization` (3/3; rejected on 2026-10-25 for low installs, so it needs your yes) | marketingskills MIT; claude-seo MIT |
| `secops-reviewer` | Upgrade | Agent: official `claude-security` (threat model, verified findings, SARIF). Skills: `security-review` and `github-actions-hardening` (github/awesome-copilot), `differential-review` (trailofbits). Removes `gha-security-review` | awesome-copilot MIT, GitHub org. claude-security needs Python 3 for its scripts [U, from its file list] |
| `architect` | Upgrade | Agent: official `feature-dev` → `code-architect`. Skills: `codebase-design` (mattpocock), `writing-plans` (obra/superpowers) | as above |
| `harness` | Upgrade | `test-driven-development` and `systematic-debugging` (obra/superpowers). Removes `webapp-testing` | as above |
| `coder` (Next.js) | Add | `vercel-composition-patterns` (vercel-labs, 3/3) | vercel-labs states MIT in its README; no LICENSE file [M]. Same limit as today |
| `designer` | Optional | `design-tokens` (julianoczkowski/designer-skills, 3/3) | Apache-2.0, 593 stars, community tier [M] |

**Considered and not proposed:** `mattpocock/improve-codebase-architecture` (1/3), `trailofbits/insecure-defaults`
(Snyk **Fail**, W007 insecure credential handling), `microsoft/playwright-cli` (1/3), and the large collections
`wshobson/agents` (41,875 stars), `VoltAgent/awesome-claude-code-subagents` (26,109) and
`sickn33/agentic-awesome-skills` (48,605). Those collections hold hundreds of agents each, which is too many to review
as a unit (the same reason ECC was excluded). Their security scores weren't checked.

## 6. Proposed CI and repo upgrades (all free)
| Upgrade | Closes Scorecard check | Free? |
|---|---|---|
| `LICENSE` (you choose MIT or Apache-2.0) | License | Yes. **Needed before open-sourcing**: the README says no licence is chosen |
| `SECURITY.md` with a contact and a disclosure window | Security-Policy | Yes |
| `CODEOWNERS`, plus a ruleset on `main`: PR review, required checks, no force push | Branch-Protection, Code-Review | Yes. A GitHub settings write, so it needs your yes in chat |
| `ossf/scorecard-action`, weekly | Shows the score | Yes |
| CodeQL (`github/codeql-action`) | SAST, as Scorecard counts it | **Only on a public repo** (F9). Semgrep CE stays either way |
| SBOM (CycloneDX) plus `actions/attest` build provenance on releases | SBOM, Signed-Releases | Yes on public repos [U for private] |

Every new action goes into `skills.lock.json`, pinned by SHA at a release at least 7 days old, like the current ones.

## 7. "Dynamic" technology, with Next.js and Cloudflare Pages as defaults
The design already allows this: `factory.config.json` → `build.framework` (`nextjs` by default, or any static
generator) and `hosting.target` (`cloudflare-pages` by default, `cloudflare-workers` or `other`). The gates read
`build.outputDir`, never a hard-coded folder (docs/TODO-step-c.md). What's missing is the code. **Proposal:** build Step
C as presets, `build.preset` = `nextjs | astro | eleventy | hugo | custom` and `hosting.preset` =
`cloudflare-pages | cloudflare-workers | custom`, each filling the build commands, output folder and deploy workflow.
The defaults stay Next.js and Cloudflare Pages, and every gate works on any preset.

## 8. How Skillselion is used in v2
To keep "nothing without Skillselion" without breaking the pinning rule:
1. **Every skill decision starts with a Skillselion search.** The query and the result are recorded in
   `skills.lock.json` (`discovery: { via: "skillselion", query, date }`).
2. **The skills.sh three-scanner result is recorded too** (`audit: { trustHub, socket, snyk, checked }`), and
   `check:skills` fails on a missing audit.
3. **Then the existing review:** newest commit at least 7 days old, file-by-file read, vendored and hashed.
4. **Never at runtime:** agents don't call `load_skill` or `synthesize_skills`. Those write the newest, unpinned version
   of a skill into a temp folder, which is the pattern in F2 and bypasses the hash check.

## 9. Found in your Claude Code setup (outside the repo)
- The **Semrush** connector is connected. Semrush is a paid subscription, and the project allows free tools only. The
  agents don't use it today, but it's offered in every session.
- **Personal skills** `system-design`, `ui-styling` and `design-system` come from `mrgoonie/claudekit-skills`, which
  was excluded (no licence). They load in every session.
- The **ECC** marketplace is registered (excluded source). The `searchfit-seo` skills are visible in sessions
  (excluded source).
- These don't change the repo, but they're on offer to any agent. I'd turn them off for this project. I haven't changed
  anything.

## 10. Decisions needed from you
1. **The 3/3 rule:** strict 3/3, or "3/3, or W011-only with the data rule" (recommended; section 4).
2. **Which of sections 5 and 6 to build.** Each lands as its own pull request with gates green; nothing loosens a gate.
3. **"Fork out the repository":** create a new repo from this template for the first site (GitHub write, your yes), or
   keep building the kit here first. `gh` isn't signed in on this machine.
4. **"SaaS website":** which product or niche? Or should `/start`'s keyword research pick it, as the kit intends?
5. **Licence and visibility:** MIT or Apache-2.0, and when to make the repo public.

## Sources
- Snyk, ToxicSkills: https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
- skills.sh audit pages, for example https://skills.sh/coreyhaines31/marketingskills/seo-audit (and `/security/snyk`)
- Skillselion: https://skillselion.com (catalogue sync 2026-10-27)
- OpenSSF Scorecard checks: https://github.com/ossf/scorecard/blob/main/docs/checks.md
- GitHub code scanning availability: https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning
- Claude Code plugin marketplaces (ref/sha pinning): https://code.claude.com/docs/en/plugin-marketplaces
- Anthropic official plugins (`claude-security`, `pr-review-toolkit`, `feature-dev`): https://github.com/anthropics/claude-plugins-official
- OWASP Top 10 for Agentic Applications 2026 (ASI04 is supply chain, per secondary sources [U]): https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
