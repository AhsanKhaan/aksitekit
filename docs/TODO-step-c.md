# TODO: Step C, starter app and gates (deferred)

Status: **not started**. Build this when a project needs it. Read `docs/BLUEPRINT.md` and `docs/CONTRACT.md` first;
Step C owns the files listed for it in the contract. Free tools only: if anything below would need a paid tool, stop and
ask the owner, and if refused, use a free alternative.

**Two parts.** Sections 2–4 (public files, gates, tests) apply to **every technology**: the gates read the built site
from `factory.config.json` → `build.outputDir` (never a hard-coded `out/`), so they work whatever produced it. Section 1
is the **Next.js starter**, used when the owner picks `nextjs` at `/start`. For any other technology the architect plans
the equivalent structure in `ARCHITECTURE.md` and sets `build.commands` / `build.outputDir`; the coder builds it to the
same rules (crawlable HTML for every page, same URLs, headers, JSON-LD, bot policy and budgets).

## 1. Next.js starter (when `build.framework` is `nextjs`; generic, no niche)
- Next.js with **static export** (`output: 'export'`, trailing slashes), TypeScript, Tailwind. Root configs:
  `next.config.ts`, `tsconfig.json`, `eslint.config.mjs` (include `eslint-plugin-no-unsanitized` and
  `eslint-plugin-regexp`), `vitest.config.ts`, `playwright.config.ts`, `postcss.config.mjs`.
  All of them must ignore `.claude/worktrees/**`: parallel sessions keep full copies of the repo there, and without the
  exclusion Vitest runs every test twice (measured 2026-10-25: 110 instead of 55 [M]).
- Pages generated from a **content registry** that reads `research/out/keyword-map.json`:
  home, category hubs, tool pages, guide pages, and the trust pages (About, Contact, Privacy, Terms, Editorial policy).
- URL rule: `/{category}/{slug}/` for tools and hubs, `/{category}/{slug}/{child}/` for guides and instances; lowercase,
  trailing slash, at most 3 levels deep. One H1 per page; breadcrumbs mirror the URL.
- Components: header, footer, breadcrumbs, a JSON-LD component (the only place allowed to use
  `dangerouslySetInnerHTML`, with `</script>` escaping), a consent banner, and optional GA4 behind consent.
- Ship one clearly marked **example** page per template so the build and tests run. `production-gate.mjs` must fail a
  production build while any example page remains.

## 2. Public files and headers
- `scripts/gen-public-files.mjs`: build `robots.txt` from `factory.config.json` → `bots`:
  - allow Googlebot, Bingbot, `AdsBot-Google`, and give `Mediapartners-Google` its own line (it ignores `*`);
  - allow AI search bots (`OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`);
  - training bots (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`) follow `bots.aiTraining`.
  Also generate the sitemap, `llms.txt` and `/.well-known/security.txt`.
- `public/_headers`: CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, third parties
  allow-listed only), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, `noindex` on
  preview hosts, HSTS on the real domain only (ramped, never `preload`).

## 3. Gates (each an npm script from the contract)
| Script | What it must check |
|---|---|
| `build` → `production-gate.mjs` | Production env values are set; no example pages; preview builds stay `noindex` |
| `build` → `check-out.mjs` | Every built page: one title and meta description (unique), one canonical, an OG image that exists, a favicon, ≥ 3 inbound links, ≤ 3 clicks deep, no broken links |
| `check:repo` | No secrets, no `.env` files, no placeholder text ("TODO", "lorem", "coming soon") in content |
| `audit` | `npm audit` gate (high and critical fail, with a reviewed-exceptions file) |
| `check:live` | Live site: 200s, HTTPS, one HSTS value, `www` and no-slash redirects, sitemap pages self-canonical, `/favicon.ico`, no NEL headers, DNSSEC validates, CAA allows only the host's certificate authorities |
| `check:security` | The blueprint's security table: XSS payload probes, CSRF (no POST endpoints, or Origin checks), path-traversal probes, a capped rate-limit burst on the project's own hosts only, private-URL and secret leaks in the output folder (`build.outputDir`) and bundles, every response served through the CDN, SPF/DKIM/DMARC |
| `gate:adsense` | Required pages present, certified consent for Europe and the UK, no ad code or `ads.txt` before approval, no placeholders, content floors met, policy-risk words |
| `gate:design` | Text and UI colour contrast meets WCAG AA from the design tokens |
| `audit:lighthouse` | `lighthouserc.json` budgets from `factory.config.json` (Accessibility, Best Practices, SEO 100; Performance ≥ 90 mobile) |
| `audit:perf`, `audit:a11y`, `audit:unique` | Lab speed with throttling, axe accessibility, duplicate-text check across pages |
| `growth:today` | Print only today's task and the streak from `growth/plan.json` |

Every gate gets a **planted failing case** in its tests (for example a fake private IP in a bundle, an unescaped XSS
payload, a missing DMARC record) to prove it fails when it should.

## 4. Tests
- Unit (Vitest): registry rules, headers and CSP, JSON-LD escaping, robots policy, each gate's planted cases.
- e2e (Playwright): every page loads with no console or CSP errors, no horizontal scroll from 320 to 1280 px, touch
  targets, consent behaviour.

## Done when
`npm run verify` passes on a fresh clone, and each gate fails on its planted case.
