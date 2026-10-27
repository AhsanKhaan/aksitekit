# Content strategy: {{PROJECT_NAME}}

<!-- Template. content-strategist fills it with research/out/content-plan.json and research/out/briefs/*.md. Replace
every placeholder (double-brace, upper-case names); label numbers [M]/[R]/[P]/[U] with their source.
Gate: node .claude/skills/gate/gate.mjs strategy. -->

## 1. Readers and promise
- **Who:** {{READERS}}
- **What they're trying to do:** {{READER_JOBS}}
- **Our promise:** {{PROMISE}} (the one thing every page does better than what ranks today).
- **Voice:** {{VOICE}} (plain, specific, no hype; answer first, then explain).

## 2. Positioning against what ranks
From `research/out/recon/*.md` (structure and gaps only, no copied text):

| Gap we fill | Seen at | How we fill it |
|---|---|---|
| {{GAP_ROWS}} | | |

## 3. Hubs and clusters
| Hub (category) | Cluster | Primary keyword | Monthly searches | Pages |
|---|---|---|---|---|
| {{HUB_ROWS}} | | | [M] / [R] | |

## 4. Waves
| Wave | Pages | Why this order | Target dates [P] |
|---|---|---|---|
| 1 | {{WAVE1_COUNT}}: the hub, its first spokes, the trust pages | Complete one topic before breadth | {{WAVE1_DATES}} |
| 2 | {{WAVE2_COUNT}} | {{WAVE2_WHY}} | {{WAVE2_DATES}} |
| 3 | {{WAVE3_COUNT}} | {{WAVE3_WHY}} | {{WAVE3_DATES}} |

Wave 1 URLs and their briefs: `research/out/content-plan.json` → `waves[0].urls`, `research/out/briefs/`.

## 5. Page standards
| Type | Word range [P] | Must have |
|---|---|---|
| tool | 600–1,500 | The tool first, a worked example from the same code, the method or formula, assumptions, FAQs from real questions |
| guide | 800–1,500 | The answer in the first paragraph, steps or sections from the brief's outline, sources |
| hub | 300–800 | What the topic covers, links to every spoke with one line each |
| trust | as needed | True today; who runs the site, how to reach them, what runs on the site |

Never pad to reach a word count; a shorter complete page beats a longer padded one.

**Gate rules every page meets** (`docs/SEO-GATE.md` §5, checked in every build):
- **Target terms** (title, H1 and primary keyword words) stay at or under 5% of the page's meaningful words; 6% fails the build.
- **Cut repetition by naming the task** in its own words ({{TASK_WORDS}}), never by vague swaps ("tools", "these").
- **Titles** are 30–60 characters, primary keyword first, and carry the URL's words.
- **Hubs** have ≥ 300 words in `<main>`, and their guide sections take facts only from the pages they link to. Trust pages have ≥ 200 words in `<main>`.
- **Date tables** put a repeated unit in the column header ("Days from today"), not in every cell.

## 6. Briefs
Each wave-1 URL has `research/out/briefs/<slug>.md` (slug = the URL path without outer slashes, `/` → `--`, `/` alone
= `home`) with: primary and secondary keywords (≤ the secondary cap), intent, the reader's question, the one-sentence
answer, the outline, what beats the current results, facts to verify with primary sources, internal links in and out,
JSON-LD types, the word range.

## 7. Trust, sourcing and E-E-A-T
- Real identity on the About page; no personas, invented authors, reviews or credentials.
- Every factual claim traced to a primary source the writer opened; sources listed on the page where useful.
- Editorial policy page: how pages are researched, checked and updated, and how to report an error.
- YMYL topics (health, money, legal, safety): {{YMYL_DECISION}} (held out of wave 1 unless the owner decides
  otherwise).

## 8. Structured data (JSON-LD plan)
| Page type | Types | Notes |
|---|---|---|
| {{SCHEMA_ROWS}} | | Only types that describe the page truthfully [U: re-check Google's current rich-result list] |

## 9. Internal linking
Hub → every spoke; spoke → hub and 2–4 related spokes; every page ≥ 3 inbound links, ≤ 3 clicks from home; descriptive
anchor text, never exact-match stuffing.

## 10. AI search and `llms.txt`
Answer-first paragraphs, clear headings and tables so passages can be cited. `llms.txt` is generated at build time
from `content-plan.json` → `llms` ({{LLMS_SUMMARY}}). AI search crawlers are allowed; training crawlers follow the
owner's choice ({{AI_TRAINING_POLICY}}).

## 11. Updates
Review each page every {{REVIEW_INTERVAL}} or when its facts change; record the date on the page. Pages that get no
impressions after {{PRUNE_AFTER}} are improved, merged or removed [P].

## 12. What we never publish
Copied or spun text, AI filler without verified facts, doorway or near-duplicate pages, invented statistics, reviews or
experts, affiliate pages without disclosure, content in AdSense-restricted categories.
