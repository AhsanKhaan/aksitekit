# Research inputs

You drop files here; `npm run research:all` turns them into `research/out/keyword-map.json`, the list of pages the
site will have. Every stage writes a file and exits 1, with a message, when a rule is broken.

| File | Who writes it | Required |
|---|---|---|
| `kp/<competitor-domain>.csv` | you: one Google Keyword Planner export per competitor | yes, at least the seed |
| `competitors.csv` | you (or `/start`) | yes |
| `idea.md` | `/start`, with your words unchanged | yes (§9) |
| `kd.csv` | the free SERP check, or you | no, but nothing is selected without a KD |
| `categories.csv` | you, to fix `uncategorized` | no |
| `examples/` | the template: **fake** sample files | never read by the pipeline |

Free tools only: Keyword Planner is free with a Google Ads account. Don't scrape Google results or use a paid API.

## 1. Export from Keyword Planner (once per competitor)
Start with the **lowest-DR competitor**: it is the seed (`factory.config.json` → `research.seedFrom`). Add the others
the same way if you want more ideas.

1. Google Ads → **Tools** → **Planning** → **Keyword Planner** → **Discover new keywords**.
2. Choose **Start with a website**, enter the competitor's domain, pick **Use the entire site**.
3. Set the location and language for your market. Keep the interface language **English**: the pipeline reads the
   column names and the words Low / Medium / High.
4. Set the date range to the **last 12 full months**. The export must have exactly 12 `Searches: <Mon YYYY>`
   columns, in a row: they drive the seasonality check.
5. **Download keyword ideas** → **.csv**. Don't open and re-save it; if you must, save as **CSV UTF-8**.
6. Save it as `research/inputs/kp/<competitor-domain>.csv`, named after the domain in `competitors.csv`
   (for example `kp/sizerpal.example.csv`). The file name becomes the keyword's `sources[]` entry.

What the pipeline accepts:
- Keyword Planner's own `.csv`: UTF-16 LE with a byte-order mark, tab-separated, two title rows, then the header.
- A UTF-8 re-save (comma, tab or semicolon), with or without the title rows. `.tsv` and `.txt` work too. Excel
  workbooks (`.xlsx`) are refused: save as CSV.
- Columns read: `Keyword`, `Avg. monthly searches` (required), `Competition`, `Competition (indexed value)`,
  `Top of page bid (low range)`, `Top of page bid (high range)`, `Currency`, and the 12 `Searches:` columns.
  Other columns are ignored.

**Volumes.** An account without ad spend sees buckets such as `1K – 10K` instead of numbers. They're stored as a range
[R] (`{ min: 1000, max: 10000, label: "R" }`); exact numbers are [M]. Nothing turns a bucket into a fake exact number.

**Competition is not keyword difficulty.** Keyword Planner's `Competition` measures how many advertisers bid on the
keyword. It's kept as `competitionAds`, a commercial signal, and never used as KD.

## 2. `competitors.csv`
```csv
domain,dr,notes,brands
sizerpal.example,12,lowest DR: the seed,
widgetwise.example,35,,Widget Wise
```
- `domain`: the competitor's host (`https://` and `www.` are stripped).
- `dr`: its Domain Rating, 0–100, from you (blank if unknown). The lowest DR is the seed.
- `notes`: free text.
- `brands` (optional): other names of the brand, separated by `|`, when they differ from the domain.

Brand filter: a keyword is rejected as `brand` when it names a competitor on word boundaries: the domain's brand label
(`sizerpal` for `sizerpal.example`, `example` for `tools.example.co.uk`) or a `brands` name, written as one word or as
several ("widget wise", "widgetwise"). If a competitor's name is an ordinary word (say `sizer.example`), every
keyword with that word is rejected; check `selected.json` → `rejected[]` and rename the domain's brand in `brands`
if that's wrong.

## 3. `kd.csv` (keyword difficulty)
```csv
keyword,kd,source,checked
example widget sizer calculator,18,serp-check,2026-10-20
```
- `kd`: 0–100. Blank means "not checked yet".
- `source`: `serp-check` (the free SERP check: the keyword researcher looks at who ranks, using Claude's web search
  and your own look at the results, never automated Google scraping) or `owner` (your value). Blank =
  `research.kdSource`.
- `checked`: the date, `YYYY-MM-DD`.
- Extra columns are ignored. A keyword listed twice with two different values is an error.

Keywords that pass every other rule but have no KD are **not selected yet**: they go to `research/out/kd-todo.csv`
(highest volume first, same columns plus a `volume` hint). Fill in `kd`, `source` and `checked`, append the rows to
`kd.csv`, and run `npm run research:select` again.

## 4. `categories.csv` (optional)
```csv
keyword,category
example gadget converter,gadgets
```
Puts a cluster head (by its primary keyword, as it appears in `keyword-map.json`) and all the pages under it in a
category. Use it for pages the pipeline left in `uncategorized`. A category is a lowercase slug.

## 5. Run it
```bash
npm run research:all
```
| Stage | Reads | Writes |
|---|---|---|
| `research:ingest` (`kp-ingest.mjs`) | `kp/*`, `kd.csv` | `research/out/keywords.json` |
| `research:select` (`keyword-select.mjs`) | `keywords.json`, `competitors.csv`, `kd.csv`, `factory.config.json` → `research` | `research/out/selected.json`, `research/out/kd-todo.csv` |
| `research:cluster` (`cluster.mjs`) | `selected.json`, `categories.csv` | `research/out/keyword-map.json` |

- `npm run research:select -- --strict` also fails while `kd-todo.csv` has rows: the "keywords are done" gate.
- `npm run research:cluster -- --check` re-checks an existing `keyword-map.json` (for example after a hand edit)
  without rebuilding it.
- `FACTORY_ROOT=<folder>` (or `--root <folder>`) runs the scripts against another copy of the project, which is how
  the tests run the examples without touching this folder.

Re-runs give byte-identical files: no timestamps, fixed sort orders.

## 6. The rules, exactly
### Ingest
- Keywords are lower-cased with whitespace collapsed. Duplicates are found **case- and space-insensitively**
  ("Example  Widget Sizer", "example widget sizer" and "examplewidget sizer" are one keyword). The other spellings
  are kept in `variants[]`, and `sources[]` lists every export the keyword was in.
- When a keyword is in several exports, one row's numbers win: an exact volume over a bucket, then the newer
  12-month window, then the higher volume, then the file name alphabetically.
- **Seasonality** = peak month ÷ median month over the 12 monthly columns (the median of 12 is the mean of the 6th
  and 7th values). A month given as a bucket counts as the bucket's geometric midpoint (`1K – 10K` → 3,162), and the
  ratio is then labelled [P]; with exact months it's [M]. It's `null` when a month is missing or the median month is 0.

### Select (first matching reason wins, in this order)
| Reason | Rule |
|---|---|
| `duplicate` | the same keyword (case and spaces ignored) is in `keywords.json` twice; the higher-volume row stays |
| `brand` | the keyword, or one of its `variants`, names a competitor (see `competitors.csv`) |
| `low-volume` | the volume's lower bound is below `research.minVolume`, or there's no volume. A `1K – 10K` bucket passes `minVolume` 1000; `100 – 1K` fails |
| `seasonal` | seasonality is above `research.maxSeasonality`, or can't be computed |
| `kd` | KD from `kd.csv` is above `research.maxKd` |
| (pending) | no KD yet: listed in `kd-todo.csv` and `selected.json` → `pending[]`, not selected |

Every keyword from `keywords.json` ends up in exactly one of `selected[]`, `pending[]` and `rejected[]`.

### Cluster: how keywords become pages
1. **Normalize** each keyword into its *topic*: lower-case; apostrophes dropped; any other character that isn't a
   letter or digit splits words; plurals made singular (irregulars such as feet → foot; otherwise `ies`→`y`,
   `sses`/`xes`/`zes`/`ches`/`shes` drop `es`, else drop `s`, but a singular that appears elsewhere in the keyword list
   wins, so "calories" becomes "calorie"; words of 3 letters or fewer, with digits, or ending in ss/us/is are left
   alone); stop words removed (a, an, the, of, for, to, in, on, with, and, or, my, your, is, are, do, does, can, …);
   the neutral words *free* and *online* removed; tool modifiers removed; what is left is a **set**, so word order
   doesn't matter.
2. **Intent** from modifiers:
   - a question word (*how, what, which, why, when, where, who*) or a first word *can, do, does, is, are, should,
     will, could, would* → **informational** (a question beats a tool modifier: "how to use a widget calculator" is a
     guide);
   - else a tool modifier (*tool, calculator, calc, generator, converter, convert, conversion, checker, estimator,
     maker, solver*) → **tool**;
   - else a guide modifier (*cost, price, chart, guide, formula, table, meaning, definition, vs/versus, tutorial,
     explained, difference*) → **informational** ("widget cost" is a guide, "widget cost calculator" a tool);
   - else **mixed** (a bare topic such as "example widgets").
   Question words and guide modifiers stay in the topic; tool modifiers don't, so "widget calculator" and "widget
   tool" are one page.
3. **Group**: keywords with the same intent and the same topic are one page. A mixed or informational group with
   exactly the same topic as a tool group joins the tool ("example widget sizer" joins "example widget sizer
   calculator"). A keyword whose topic is empty ("online calculator") is discarded as `generic`.
4. **Primary** = the group's highest-volume keyword (lower bound, then upper bound, exact before bucket), then one
   whose own intent is the page's, then the shorter, then alphabetical. The rest are **secondary**, at most
   `research.maxSecondaryKeywordsPerPage`; the overflow is discarded as `secondary-cap` (no keyword stuffing).
5. **Parents** (one level only, so URLs are at most 3 deep):
   - a tool whose topic strictly contains another top-level tool's topic is an **instance** under it;
   - an informational or mixed group whose topic strictly contains a top-level tool's topic is a **guide** under that
     tool; failing that, under a top-level mixed group whose topic it strictly contains, which becomes a **hub**;
   - when several parents fit, the most specific one (largest topic) wins, then the higher volume, then alphabetical;
   - top-level informational groups are **guides**; a top-level mixed group is a **hub** when pages sit under it,
     else a **guide**. Tools never sit under hubs.
6. **Category**, per cluster head (top-level page): `categories.csv` if it names the head; else the head's topic word
   shared with the most other heads (at least 2 heads; numbers, question words and guide modifiers don't count;
   with 3 or more heads, a word in every head is the niche itself and is skipped; ties: more volume, then
   alphabetical), written the way the keywords write it; else **`uncategorized`**, for you to fix in
   `categories.csv`. Pages under a head share its category.
7. **URLs**: `/{category}/{slug}/` for heads, `/{category}/{head-slug}/{slug}/` for pages under them;
   `slug` = the primary keyword, lower-case, accents stripped, every run of other characters → `-`.
8. **Gate** (`cluster.mjs`, and `--check`): fails when a URL breaks the pattern or depth, two pages share a URL, **two
   URLs share a primary (cannibalization)**, a keyword is owned twice, a page has more secondaries than the cap, a
   parent link is wrong, or a selected keyword is neither on a page nor in `discarded[]`.

`keyword-map.json` is `{ pendingKd, pages: [{ url, type, category, primary, secondary[], intent, cluster, parent,
evidence }], discarded: [{ keyword, reason, detail }] }`. `cluster` is the head's slug; `evidence` holds the rules that
placed the page and the primary keyword's numbers (volume, KD, seasonality, ad competition, sources).

Known limits: the rules can't see meaning. "cm to inches" and "inches to cm" are one topic (word order is ignored);
"how much does a widget cost" and "widget cost" stay two pages; synonyms (cost / price) are not merged. Check the map
before building, and fix categories in `categories.csv`.

## 7. Number labels
In the outputs, `label` / `seasonalityLabel` say how far to trust a number: **M** taken as-is from the export,
**R** a range (Keyword Planner bucket), **P** a proxy computed from buckets, **U** unknown.

## 8. The examples
`examples/` holds **fake** files to try the pipeline (and a fake `idea.md` showing its format): made-up competitors on the reserved `.example` domain and
keywords such as "example widget sizer", with invented numbers. They are not research and must never be copied into
real inputs. `examples/kp/sizerpal.example.csv` is saved exactly like a real download (UTF-16 LE, tabs), so most editors
show it as binary; `examples/kp/widgetwise.example.csv` is the UTF-8 re-save.

To try them without touching this folder:
```bash
mkdir -p /tmp/factory-try/research/inputs && cp factory.config.json /tmp/factory-try/ && cp -r research/inputs/examples/. /tmp/factory-try/research/inputs/ && FACTORY_ROOT=/tmp/factory-try npm run research:all
```

## 9. `idea.md` (your idea)
`/start` asks what visitors should be able to do on your site and who they are, and saves your answer here word for
word. The keyword scripts don't read it; the agents do.
```markdown
# The idea

## In the owner's words
A free site where people sizing example widgets type their measurements and get the right size.

## Owner answers
- 2026-11-02: Both inches and centimetres.
```
- **In the owner's words:** your answer, unchanged. `docs/IDEA.md` must quote it exactly, so the groomed idea can't
  drift from what you said.
- **Owner answers:** your answers to the groomer's open questions and the changes you ask for, dated, in your words.
- Recon measures each competitor against it, the idea-groomer turns both into `docs/IDEA.md`, and you approve that
  file with `APPROVE <hash>` before the keyword stage (README → Step 6).
