# Step C: starter app and gates

Status: **built** (2026-10-29), and `npm run verify` passes end to end since lint was unblocked
([Lint on TypeScript 7](#lint-on-typescript-7)). What was built and where is under [Built](#built); the spec below is
kept as the reference the gates are held to. Step C owns the files
listed for it in `docs/CONTRACT.md`. Free tools only: if anything below would need a paid tool, stop and ask the owner,
and if refused, use a free alternative.

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
| `build` → `check-out.mjs` | Every built page: one title and meta description (unique), one canonical, an OG image that exists, a favicon, ≥ 3 inbound links, ≤ 3 clicks deep, no broken links; the output folder holds no hidden file but `.well-known/` (a `.gitkeep`, `.DS_Store` or `.env` would go live) |
| `build` → `scripts/audits/seo-checks.mjs` | **Already built** (`docs/SEO-GATE.md`). The starter's pages must pass it with 0 fail (navbar links included: their text is the label alone, with any count or note drawn by CSS, never a run-together "Pets1"): target terms ≤ 6% of meaningful words, titles 30–60 characters with the URL's words, one canonical and H1, `lang`, a visible disclaimer, links to about, contact, privacy, terms, editorial policy and an author page, table headers, JSON-LD `@type`, budgets for HTML and inline JS. Add an exception to `seo-checks.json` only with the owner's yes and a reason |
| `check:repo` | No secrets, no `.env` files, no placeholder text ("TODO", "lorem", "coming soon") in content |
| `audit` | `npm audit` gate (high and critical fail, with a reviewed-exceptions file) |
| `check:live` | Live site: 200s, HTTPS, one HSTS value, `www` and no-slash redirects, sitemap pages self-canonical, `/favicon.ico`, no NEL headers, DNSSEC validates, CAA allows only the host's certificate authorities |
| `check:security` | The blueprint's security table: XSS payload probes, CSRF (no POST endpoints, or Origin checks), path-traversal probes, a capped rate-limit burst on the project's own hosts only, private-URL and secret leaks in the output folder (`build.outputDir`) and bundles, every response served through the CDN, SPF/DKIM/DMARC |
| `gate:adsense` | Required pages present, certified consent for Europe and the UK, no ad code or `ads.txt` before approval, no placeholders, content floors met, policy-risk words |
| `gate:design` | Text and UI colour contrast meets WCAG AA from the design tokens |
| `audit:lighthouse` | `lighthouserc.json` budgets from `factory.config.json` (Accessibility, Best Practices, SEO 100; Performance ≥ 90 mobile) |
| `audit:perf`, `audit:a11y`, `audit:unique` | Lab speed with throttling, axe accessibility, duplicate-text check across pages |
| `check:release` | Content ready to publish: every claim traces to a source in its brief, and an AI-writing scan (the strongest patterns in `vendor/skills/humanizer/SKILL.md`, written as fixed phrase and structure rules) fails a page where they pile up |
| `growth:today` | Print only today's task and the streak from `growth/plan.json` |

Every gate gets a **planted failing case** in its tests (for example a fake private IP in a bundle, an unescaped XSS
payload, a missing DMARC record) to prove it fails when it should.

## 4. Tests
- Unit (Vitest): registry rules, headers and CSP, JSON-LD escaping, robots policy, each gate's planted cases.
- e2e (Playwright): every page loads with no console or CSP errors, no horizontal scroll from 320 to 1280 px, touch
  targets, consent behaviour.

## Done when
`npm run verify` passes on a fresh clone, and each gate fails on its planted case.

## Built
Results on 2026-10-29, Windows, Node 24.22.0, on the locked dependencies [M: these runs]:

| Check | Result |
|---|---|
| `npm run check:skills`, `check:repo`, `audit` | pass |
| `npm run lint` (eslint 10.13.0 on the TypeScript 6.0.3 API, [below](#lint-on-typescript-7)) | pass: 0 problems [M: `npm run verify` on branch `fix/lint-ts7-alias`] |
| `npm run typecheck` (TypeScript 7.0.2) | pass |
| `npm test` | 270 pass, 7 skipped (the release-only cases), 24 files [M: the same run] |
| `npm run verify` | pass end to end, with `SITE_URL=https://example.com` [M: the same run] |
| `npm run build` | pass: production-gate, gen-public-files, `next build`, check-out (12 pages), the SEO gate (0 fail, 75 warn) |
| `npm run test:e2e` | 41 pass, 1 skipped (consent with analytics: the template has no GA4 ID) |
| `npm run audit:a11y`, `audit:unique` | pass (0 axe violations on 13 pages; every page ≥ 96% unique) |
| `node .github/scripts/selftest.mjs` | 8 pass |
| `npm run gate:adsense`, `check:release` | NO-GO / fail on the template, as they should: its pages are examples with no briefs |
| `npm run gate:design` | waits for `docs/DESIGN.md` (the design stage writes it; the template file passes its 8 pairs) |

On the bare template (no `project.domain`), build with `SITE_URL=https://example.com`: the SEO gate refuses to guess a
site URL (its own test says so), while the other gates and the app fall back to example.com.

| Part | Files |
|---|---|
| Starter app | `app/` (home, `[category]` routes 3 levels deep, trust pages, author page, 404, share images, icons), `components/`, `lib/` (registry, content schema, JSON-LD, metadata, consent, analytics, the example tool), `app/globals.css` (Tailwind v4, DESIGN.md tokens, 44 px targets) |
| Example content | `content/site.json`, `content/pages/*.json`, `content/examples/keyword-map.json`: one page of each type, about the kit itself so no niche is implied, all `"example": true` |
| Public files | `scripts/gen-public-files.mjs`, `scripts/lib/public-files.mjs` |
| Gates | `scripts/production-gate.mjs`, `check-out.mjs`, `check-repo.mjs`, `audit.mjs` (+ `audit-exceptions.json`), `check-live.mjs`, `check-security.mjs`, `adsense-gate.mjs`, `design/contrast.mjs`, `growth/today.mjs`, `audits/{perf,a11y,unique-text,ga-live}.mjs`, `tests/content.test.ts` (check:release) |
| Shared | `scripts/lib/site.mjs` (config, site URL, build context, HTML readers), `scripts/lib/content-rules.mjs` (floors, policy terms, AI-writing scan, brief check) |
| Serving | `scripts/serve-out.mjs` (CDN-like: `_headers`, 308 slash redirects, 405 on writes, 404 page), `scripts/flatten-segments.mjs` |
| Tests | `tests/starter/`, `tests/gates/` (a planted failing case for every gate), `tests/content.test.ts`, `tests/e2e/site.spec.ts` |

**Every technology:** `build.commands.build` ends with `node scripts/gen-public-files.mjs --after-build`, which writes
`sitemap.xml` and `llms.txt` from the pages the build wrote (the Next.js default in `factory.config.json` does). The
npm `build` script writes `robots.txt`, `_headers` and `security.txt` before the build.

## Lint on TypeScript 7
**Unblocked on 2026-10-29.** Before the fix, `npm run lint` failed before linting a file [M: `npm run lint`, 2026-10-29]:

```text
Error: typescript-eslint does not support TS 7.0.
    at …/node_modules/eslint-config-next/node_modules/typescript-eslint/dist/index.js:52:11
```

The cause: typescript-eslint, loaded by eslint-config-next, needs the TypeScript compiler API, and TypeScript 7.0 ships
without one. Neither the latest typescript-eslint (8.72.1) nor the latest eslint-config-next (16.4.3) supports
TypeScript 7; both still want TypeScript < 6.1 [M: `npm view`, 2026-10-29].

**The fix** keeps eslint 10.13.0, eslint-config-next 16.4.2 and the TypeScript 7.0.2 compiler. It uses the side-by-side
setup from Microsoft's TypeScript 7.0 announcement, which the owner chose:

| `package.json` devDependency | Resolves to | Used by |
|---|---|---|
| `"@typescript/native": "npm:typescript@7.0.2"` | the TypeScript 7.0.2 compiler (`tsc`) | `npm run typecheck` |
| `"typescript": "npm:@typescript/typescript6@6.0.2"` | the TypeScript 6.0.3 API (`tsc6`) | typescript-eslint, and the type check inside `next build` |

What else changed, each with the owner's yes:
- **check:repo.** It now also accepts an npm alias pinned to an exact version (`npm:<name>@x.y.z`). Ranges, tags and a
  bare `npm:<name>` still fail, with planted cases in `tests/gates/repo-audit.test.ts`.
- **eslint.config.mjs.** ESLint 10 lints every file a `files` pattern names, so `*.config.*` now lists script
  extensions only. It had pulled in `factory.config.json`.
- **Regexes.** Once lint ran, it found 70 problems in 17 files, nearly all from eslint-plugin-regexp, including
  11 regexes that could backtrack polynomially. Each one was rewritten to match exactly what it matched before
  [M: old against new on about 20,000 inputs each, 0 differences in what the caller gets].
- **Inline exceptions.** Three lines that are correct on purpose carry `eslint-disable-next-line` with a reason: two
  `javascript:` XSS test payloads and the gate runner's colour-code strip.

Supply-chain checklist for the two aliased packages [M: `npm view`, `npm audit`, `npm audit signatures`, 2026-10-29]:

| Check | `@typescript/typescript6` 6.0.2 → typescript 6.0.3 | typescript 7.0.2 |
|---|---|---|
| Publisher | Microsoft (`typescript-deploys`, `typescript-bot`) | Microsoft (`microsoft1es`) |
| Age | 115 and 196 days | 113 days |
| Install scripts | none | none |
| Exact version in `package.json` | yes | yes |

`npm audit` reports 0 vulnerabilities. `npm audit signatures` verifies registry signatures on all 396 packages.
The vendored supply-chain-risk-auditor was not run, because `uv` isn't installed on this machine.

**Undo when typescript-eslint supports TypeScript 7.1** (typescript-eslint issue 10940; work in progress, no date).
Then set `"typescript"` back to a plain exact version and drop `@typescript/native`. Whether Dependabot handles npm
aliases is unverified [U]; check its first npm pull request after this lands.

## Follow-ups (outside Step C's files)
- `.github/workflows/ci.yml` (Step D): set `SITE_URL` for the build when `project.domain` is empty, or the template's
  own CI build stops at the SEO gate; and a Dependabot rule that holds major ESLint and TypeScript bumps for review.
- `.claude/agents/architect.md` (Step A): tell the architect that a non-Next.js `build.commands.build` ends with
  `node scripts/gen-public-files.mjs --after-build`.
- `package.json` (Phase E): `"type": "module"` (Vitest warns that it loads `vitest.config.ts` as CommonJS). This isn't a
  one-line change. 11 test files use `__dirname`, which ES modules don't have. One of them is `tests/e2e/site.spec.ts`,
  which Playwright would then load as ESM. They need `import.meta.dirname` first, then a full build and e2e run.
  (`lint:design` is done: the devDependency `@google/design.md` 0.4.0, added 2026-10-30.)
- `scripts/adsense-gate.mjs` judges page types from `research/out/keyword-map.json` only, so on the template it holds the
  example tool to the guide floor; it fails there anyway on the example pages.
