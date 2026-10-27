# On-page SEO gate and content rules

`scripts/audits/seo-checks.mjs` checks every built page against the 171 checks of a SEOmator site audit, in its 16 categories, plus build budgets. It was built on calculatorporch.com on 2026-10-25, after a SEOmator audit flagged keyword stuffing on its home page and Ubersuggest flagged 10 thin pages and 2 short titles [M: that project's reports]. Keyword stuffing is a Google spam policy, and thin pages are AdSense's "low value content" reason for rejection. This gate is how a site made from this template never ships either one.

## 1. How it runs

| Where | Command | What it checks | Blocks |
| --- | --- | --- | --- |
| Every build (`npm run build`, so CI, `preprod.yml` and the deploy workflows) | `node scripts/audits/seo-checks.mjs` after `check-out.mjs` | 169 checks on every page of `build.outputDir` | yes, on any `fail` |
| On demand | `npm run audit:seo` (`-- --strict` makes warnings fail; `-- --json` for a report) | the same | yes |
| After every production deploy, and daily in `live-check.yml` | `npm run check:seo-live -- https://<domain> / /contact/` | compression, Brotli, HTTP/3, `Cache-Control`, warm response time ≤ 600 ms, HSTS, the security headers, the http→https redirect | yes |
| The `gate` skill | stage `seo` runs `build` and `audit:seo`; stage `deploy` runs `check:live` and `check:seo-live` with `--url` | | yes |

**Results:**
- **fail** blocks the build;
- **warn** is printed (`--strict` makes it fail);
- **accepted** is a reviewed exception, printed once per check with its reason.

**Production-only checks.** The robots and AI-bot checks run only on production builds (`SITE_INDEXABLE` or `NEXT_PUBLIC_INDEXABLE` = `true`). Preview builds are `noindex, nofollow` by design.

**Not on previews.** Don't run the live checks against a preview: `*.pages.dev` previews have no HSTS on purpose.

## 2. The 16 categories

core, content, performance, links, images, security, accessibility, structured data, social, E-E-A-T, URL, mobile, HTML, redirects, AI/GEO and i18n.

The checks that matter most for AdSense and spam policy:

| Check | Rule | Level |
| --- | --- | --- |
| `content.keyword-stuffing` | A target term (the title's, the H1's or the keyword-map primary's words; the site name excluded) over 5% of meaningful words | warn |
| | over 6% | **fail** |
| | All forms of a target word together over 8% | **fail** |
| | Any single word over 6% | warn |
| | Any single word over 8% | **fail** |
| | A month or weekday name that isn't a target term (date tables are data, and move with the build date) | warn only |
| `content.word-count` | Under 300 meaningful words on the whole page | warn |
| `core.title-length` | Under 30 characters | warn |
| | Over 60 characters or 580 px | **fail** |
| `url.slug-keywords` | Fewer than half the URL slug's words appear in the title | warn |
| `eeat.disclaimers`, `eeat.*-link`, `eeat.author-byline` | A visible disclaimer, and links to about, contact, privacy, terms, editorial policy and an author page | **fail** |
| `eeat.external-citations` | The home page and keyword-map pages link to at least one outside source | warn |
| `links.joined-anchor-text` | A link's text runs together when read the way SEO tools read it (tags removed with nothing in their place): `<span>Pets</span><span>1</span>` is the anchor "Pets1" | **fail** |
| `accessibility.table-headers`, `links.descriptive-anchors`, `structured-data.type-present`, `security.mixed-content` | Tables have headers; links have visible text; JSON-LD nodes have `@type`; no `http://` resources | **fail** |

## 3. The density method (SEOmator's)

1. Take the whole page's visible text.
2. Keep words of 3+ letters; drop numbers and common stopwords.
3. Density = occurrences ÷ meaningful words.

Calibrated on calculatorporch.com's home page: 309 meaningful words against SEOmator's 304 [M]. Pixel widths use Arial at 14.1 px, which reproduces SEOmator's 331.5 px title and 920.5 px description [M].

There is no target density: never add repeats to reach a number. The limits are only a ceiling.

## 4. Configuration (`seo-checks.json`)

**Settings:**
- **Blank settings come from `factory.config.json`:**
  - `outDir` ← `build.outputDir`;
  - `siteUrl` ← `https://` + `project.domain`;
  - `siteName` ← `project.brand`, else `project.name`.
- **Environment names:**
  - `siteUrlEnv` and `indexableEnv` take lists, so the technology-neutral `SITE_URL` / `SITE_INDEXABLE` and the Next.js `NEXT_PUBLIC_*` names both work;
  - `keywordMap` points at `research/out/keyword-map.json`.
- **Thresholds** are starting defaults [P]. Tune them per project, and only with a reason.

**Exceptions:**
- Each one needs four fields:
  - `check` (the id);
  - `pages` (`"*"` or a list of routes);
  - `reason`;
  - `reviewed` (a date).
- Rules:
  - The owner approves every exception, and each one is looked at again within 3 months.
  - **Never add one to make a real problem go away.**
- Exceptions calculatorporch.com accepted, with its reasons (examples, not defaults):
  - **text-to-HTML ratio, page weight and inline JS:** Next.js inlines page data and, with `inlineCss`, the CSS. Turning `inlineCss` off made mobile LCP 0.5–0.95 s slower [M], and the size budgets still fail real bloat;
  - **share buttons:** none by design, because widgets add third-party scripts and cookies;
  - **social profiles, trust badges:** none exist yet, and they're never invented;
  - **physical address:** an online-only site, and the owner's address stays private;
  - **HSTS details:** during the HSTS ramp;
  - **stop words:** in slugs that match the researched query word for word;
  - **word count on trust pages:** padding them would make them worse.

## 5. Content rules the gate enforces (and how to meet them honestly)

- **Name the task, not the category.**
  - To cut a repeated word, write the task in its own words ("fractions, discounts, gravel orders, sun hours, due dates").
  - **Never swap in a vague word** ("tools", "these", "it", "the resource"). It loses the meaning and only moves the repetition: on calculatorporch.com, "tools" reached 5.3% the same day [M].
- **Titles** are 30–60 characters, primary keyword first, and carry the URL's words. A `/pets/` hub titled "Pet Calculators" was flagged as a "poorly formatted URL"; "Calculators for Pets" fixed it. Never change a live URL to fix a title.
- **Word counts:**
  - category hubs and the A–Z index need at least 300 words in `<main>`;
  - trust pages need at least 200;
  - tool pages need 600–1,500 words and guides 800–1,500 (HANDBOOK §8).

  These are floors. Never pad.
- **Hub guide sections** take their facts only from the tool pages they link to. They answer the visitor's next question ("which standard deviation does my teacher want?"), with worked examples computed by the same code as the tool.
- **Date-dependent pages** (ages, countdowns, "N days from today") change with every rebuild. Put a repeated unit in the column header once ("Days from today": "204 to go", "4,796 ago"), not in every cell, so the build date can never push a page over a fail line. On calculatorporch.com the build date took "days" on the age page from 5.98% to 6.08% in two days [M].
- **Link text is the label alone.** A count or note inside a link ("Pets" plus "1" in a phone menu) joins the label in the HTML that SEO tools read ("Pets1"), even when it's hidden on screen. Draw such notes with CSS from a `data-` attribute (`content: attr(data-note) / ""`), or keep them outside the link. calculatorporch.com shipped "Pets1" and "All calculatorsA–Z…" in its navbar until 2026-10-27 [M].
- **Humanized writing:**
  - short sentences, second person;
  - no em dashes;
  - no stock phrases ("in today's world", "look no further", "unlock", "delve", "seamless", "comprehensive guide");
  - `check:release` runs the AI-writing scan.
- **Dates are honest.** A page's `updated` date changes only when its text changes, and the sitemap uses the same date.

## 6. Measuring with outside tools

- **Ubersuggest** seems to leave out the header and footer. Its counts ran about 65 words under the whole body, and further under on list-heavy pages [P: fitted on calculatorporch.com].
- **SEOmator** counts meaningful words on the whole page, as this gate does.
- After a deploy, re-crawl the changed pages in the outside tool and record the result [M] next to the gate's own numbers.
- **Tool artifacts:** SEOmator reported "no compression" and "no HTTP/2+" on a site that served Brotli and advertised `h3`. `check:seo-live` reads the real response headers, so trust it over a crawler's summary.
