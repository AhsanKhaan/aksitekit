# Architecture: {{PROJECT_NAME}}

<!-- Template. The architect fills it; doc-generator refreshes §10. Replace every placeholder (double-brace, upper-case
names); label numbers [M]/[R]/[P]/[U] with their source. Gate: node .claude/skills/gate/gate.mjs architecture. -->

## 1. Decision
| | |
|---|---|
| Hosting target | **{{HOSTING_TARGET}}** (`factory.config.json` → `hosting.target`), free plan |
| Why | {{HOSTING_REASON}} |
| Owner confirmed | {{OWNER_CONFIRMED_DATE}} |
| Production branch | {{PRODUCTION_BRANCH}} |

**Rule:** a static export (no server code, no forms that post, no per-request logic) goes to **Cloudflare Pages**.
**Workers static assets** only when the app needs server-side code; name the feature that forces it. Any other host
must offer the same on a free plan: HTTPS, custom headers (`_headers` or equivalent), preview deployments, rollbacks.

## 2. Stack
| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js, static export (`output: 'export'`, trailing slashes), TypeScript | From the starter (Step C) |
| Styling | Tailwind, tokens from `docs/DESIGN.md` | No runtime CSS-in-JS |
| Content | Registry generated from `research/out/keyword-map.json`; page content in `content/` | One owner URL per keyword |
| Tests | Vitest (unit), Playwright (e2e) | `npm test`, `npm run test:e2e` |
| Server code | {{SERVER_CODE}} | "None" for a static export |

## 3. Page templates
| Type | URL pattern | Count [M] | Blocks in order | JSON-LD |
|---|---|---|---|---|
| hub | `/{category}/` | {{N_HUB}} | {{HUB_BLOCKS}} | {{HUB_SCHEMA}} |
| tool | `/{category}/{slug}/` | {{N_TOOL}} | {{TOOL_BLOCKS}} | {{TOOL_SCHEMA}} |
| guide | `/{category}/{slug}/{child}/` | {{N_GUIDE}} | {{GUIDE_BLOCKS}} | {{GUIDE_SCHEMA}} |
| instance | `/{category}/{slug}/{child}/` | {{N_INSTANCE}} | {{INSTANCE_BLOCKS}} | {{INSTANCE_SCHEMA}} |
| trust | `/about/`, `/contact/`, `/privacy/`, `/terms/`, `/editorial-policy/` | 5 | text | `Organization` / `WebPage` |

URL rules: lowercase, trailing slash, at most 3 levels deep; one H1 per page; breadcrumbs mirror the URL; every page
gets at least 3 inbound internal links and is at most 3 clicks from home.

## 4. Data flow and build
```text
research/out/keyword-map.json ─► content registry ─► pages (static export) ─► out/
factory.config.json ─► gen-public-files.mjs ─► robots.txt, sitemap.xml, llms.txt, security.txt
npm run build = production-gate → gen-public-files → next build → flatten-segments → check-out
```

## 5. Headers and CSP (`public/_headers`)
`default-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; no `unsafe-eval`; `X-Content-Type-Options:
nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` denying unused features; COOP;
`X-Robots-Tag: noindex` on preview hosts; HSTS on the real domain only, ramped (see `docs/SECURITY.md`), never `preload`.

## 6. Third parties
| Host | Purpose | CSP directive | Privacy page line | Added |
|---|---|---|---|---|
| {{THIRD_PARTY_ROWS}} | | | | |

Default: none. Analytics (GA4) loads only after consent; ad hosts are added only after AdSense approval.

## 7. Bots (`robots.txt`, from `factory.config.json` → `bots`)
Allow Googlebot, Bingbot and `AdsBot-Google`; `Mediapartners-Google` gets its own group (it ignores `*`); AI search
crawlers (`OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`) allowed; training
crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`): **{{AI_TRAINING_POLICY}}** (the owner's choice), enforced
on Cloudflare with AI Crawl Control (free).

## 8. Environments
| Environment | Host | Indexable | Ads | Analytics |
|---|---|---|---|---|
| Local | `localhost` | no | never | never |
| Preview | {{PREVIEW_HOST_PATTERN}} | no (`noindex`) | never | never |
| Production | {{DOMAIN}} | yes | only after approval | after consent |

## 9. Deploy and rollback
Merge to `{{PRODUCTION_BRANCH}}` after the owner's GO → `{{DEPLOY_WORKFLOW}}` (wrangler-action, scoped token secret,
`production` environment) → `npm run check:live`. Rollback: the host's previous deployment ({{ROLLBACK_METHOD}}), then
fix forward on a branch.

## 10. Free-plan limits relied on
| Limit | Value | Source |
|---|---|---|
| {{LIMIT_ROWS}} | | [M: docs URL, date] or [U] |

## 11. Status (refreshed by doc-generator)
{{ARCHITECTURE_STATUS}}

## 12. Decision log
| Date | Decision | By | Why |
|---|---|---|---|
| {{DECISION_ROWS}} | | | |
