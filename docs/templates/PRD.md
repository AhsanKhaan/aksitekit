# PRD: {{PROJECT_NAME}}

<!-- Template. doc-generator fills it from factory.config.json, docs/IDEA.md (the owner-approved idea), research/out/*,
docs/CONTENT-STRATEGY.md and docs/GROWTH-90.md. Every placeholder (double-brace, upper-case names) must be replaced; label every number
[M] measured, [R] range, [P] proxy/estimate, [U] unverified, with its source. -->

| | |
|---|---|
| Domain | {{DOMAIN}} |
| Brand | {{BRAND}} |
| Markets and language | {{MARKETS}} · {{LOCALE}} |
| Idea | `docs/IDEA.md`, approved by the owner at {{IDEA_APPROVED_HASH}} |
| Hosting | {{HOSTING_TARGET}} (free plan) |
| Status | {{PIPELINE_STATUS}} (from `node .claude/skills/gate/gate.mjs status`) |
| Last updated | {{DATE}} |

## 1. Problem and readers
{{READER_PROBLEM}}: who searches for this, what they need to get done (the jobs in `docs/IDEA.md` §2), and what's
wrong with today's results (from `docs/IDEA.md` §3–4 and `research/out/recon/*.md`, described, never quoted at length).

## 2. Goal
A useful, original site that answers {{NICHE_SUMMARY}} better than what ranks today, and earns from display ads only
after it qualifies under AdSense policies. No check can guarantee rankings or approval; Google decides.

## 3. Evidence
| Item | Value | Source |
|---|---|---|
| Competitors analysed | {{COMPETITOR_COUNT}} | `research/inputs/competitors.csv` (DR from the owner [M: owner]) |
| Keyword seed | {{SEED_COMPETITOR}} (lowest DR) | intake gate |
| Keywords in / kept / rejected | {{KW_IN}} / {{KW_KEPT}} / {{KW_REJECTED}} | `research/out/selected.json` [M] |
| Mapped URLs | {{URL_COUNT}} | `research/out/keyword-map.json` [M] |
| Combined monthly searches of kept primaries | {{VOLUME_SUM}} | Keyword Planner [M] or [R] |

## 4. Scope
**Wave 1 (launch):** {{WAVE1_SUMMARY}} — the "must" features of `docs/IDEA.md` §6 as pages: the hub, its first spokes and the trust pages (About, Contact, Privacy,
Terms, Editorial policy). Full list: `research/out/content-plan.json`.

**Later waves:** {{LATER_WAVES_SUMMARY}}.

**Not in scope:** user accounts, comments, forms that store data, paid tools, and YMYL topics unless the owner decides
otherwise ({{OUT_OF_SCOPE_EXTRA}}).

## 5. Requirements
| # | Requirement | Gate that proves it |
|---|---|---|
| R1 | Every mapped keyword has exactly one owner URL | `npm run research:cluster` |
| R2 | Every page is original, useful and within its word range; no placeholders | `npm run check:release`, `npm run audit:unique`, `npm run check:repo` |
| R3 | Accessibility, Best Practices and SEO 100; Performance ≥ 90 on mobile; LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 | `npm run audit:lighthouse`, `audit:perf`, `audit:a11y` |
| R4 | Works from 320 to 1280 px, no horizontal scroll | `npm run test:e2e` |
| R5 | The security-check table passes | `npm run check:security -- <url>`, `security.yml` |
| R6 | No ad code or `ads.txt` before approval; consent for EEA/UK/CH visitors | `npm run gate:adsense` |
| R7 | Titles, canonicals, sitemap, schema, internal links, depth ≤ 3 | `npm run build` (`check-out.mjs`) |
| R8 | Production only after the owner's GO for the exact SHA | `preprod.yml`, the ledger's `go` row |

## 6. Success measures (targets [P], reviewed at day 30, 60 and 90)
| Measure | Day 30 | Day 60 | Day 90 | Source |
|---|---|---|---|---|
| Indexed pages | {{T_INDEXED_30}} | {{T_INDEXED_60}} | {{T_INDEXED_90}} | Search Console (owner) |
| Organic clicks per week | {{T_CLICKS_30}} | {{T_CLICKS_60}} | {{T_CLICKS_90}} | Search Console (owner) |
| Pages published | {{T_PAGES_30}} | {{T_PAGES_60}} | {{T_PAGES_90}} | sitemap [M] |

## 7. Monetisation
AdSense only after `npm run gate:adsense` passes, the trust and identity items are true, and organic traffic history
exists [U: Google publishes no fixed threshold]. Until then: {{PRE_ADSENSE_PLAN}}.

## 8. Risks
| Risk | Mitigation |
|---|---|
| Thin or unoriginal content (AdSense "low value") | Briefs, the unique-text check, word floors without padding |
| Seasonal or over-competitive keywords | The seasonality and KD caps in `factory.config.json` |
| Supply-chain compromise | Pinned sources, 7-day rule, `npm audit` gate, Semgrep, gitleaks |
| Invalid ad traffic | Ads off in automation and previews; the owner's household briefed |
| {{EXTRA_RISK}} | {{EXTRA_MITIGATION}} |

## 9. Owner decisions
{{OWNER_DECISIONS}} (each with its date; for example the approvals of `docs/IDEA.md` and `docs/DESIGN.md`, the training-bot policy `bots.aiTraining`, hosting confirmation).
