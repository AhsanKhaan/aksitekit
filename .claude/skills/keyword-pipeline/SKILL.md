---
name: keyword-pipeline
description: Run the keyword stage. Checks the owner's Keyword Planner CSVs, adds keyword difficulty from the free SERP check, runs ingest → select → cluster through the gate, and summarises what was kept, what was rejected and why, and which URL owns each keyword. Use for "/keyword-pipeline", "run the keyword research", "the CSVs are in", "re-cluster the keywords".
argument-hint: "[check | kd | run | summary]"
---

Run the keyword stage (mode: `$ARGUMENTS`; empty means `check`, then `kd`, then `run`, then `summary`). The judgment
calls go to the `keyword-researcher` agent; the scripts decide.

## Rules for this stage
- **Free tools only.** Keyword Planner exports come from the owner. No paid keyword API, no paid SEO tool. If a step
  would need one, stop and ask the owner; if they say no, use the free method below.
- **Never scrape Google** (no automated queries, no headless browsing of result pages, no CAPTCHA bypass).
- **"Competition" is not KD.** Keyword Planner's Competition column is advertiser bidding. It's stored as
  `competitionAds` (commercial value) and never used as difficulty.
- **Never invent numbers.** Volumes are [M: Keyword Planner] or [R] when Keyword Planner shows a range; KD from the SERP
  check is [P]; anything not checked is [U].

## check
1. `research/inputs/competitors.csv` exists and the intake gate passed (`node .claude/skills/gate/gate.mjs status`).
2. `research/inputs/kp/` has at least the seed competitor's file (`<seed-domain>.csv`). If not, give the owner the
   export steps from `/start` §2 and stop.
3. Each file is Keyword Planner's export (UTF-16 tab-separated, two title rows, then a header with `Keyword`,
   `Avg. monthly searches`, `Competition`, `Competition (indexed value)`, bid columns and 12 `Searches: <Mon YYYY>`
   columns) or UTF-8 CSV with the same header. Don't convert or edit the owner's files; `research:ingest` reads both.
   An `.xlsx` file is not accepted: ask for CSV.

## kd (free SERP check, optional but recommended)
For the candidate keywords that pass the volume floor (`research.minVolume`) and aren't seasonal:
1. Use **Claude's WebSearch** (standard mode) for each keyword, one search per keyword, and note the domains that rank.
2. Estimate difficulty 0–100 [P] from what ranks: forums, Q&A and thin pages near the top mean easier; strong brands and
   big publishers throughout mean harder. If the owner knows the DR of ranking domains, use it and say so.
3. Write `research/inputs/kd.csv` with header `keyword,kd,source,checked`: `source` is `serp-check` (or `owner`),
   `checked` is today's date. Never overwrite a row whose source is `owner`.
4. Keep it small: the top candidates, not every keyword. A keyword without a KD row has no difficulty measurement
   [U]; it must never be counted as easy (if the selection treats it so, report it as a Step B bug).

## run
`node .claude/skills/gate/gate.mjs keywords` runs `npm run research:ingest`, `research:select` and `research:cluster`
in order and checks `research/out/keywords.json`, `selected.json` and `keyword-map.json`. The scripts (Step B) apply
`factory.config.json` → `research`: `minVolume`, `maxKd`, `maxSeasonality` (peak month ÷ median month over the 12
monthly columns) and `maxSecondaryKeywordsPerPage`, and give every keyword exactly one owner URL or a discard reason.

- BLOCKED because `scripts/research/*.mjs` don't exist: Step B hasn't landed in this copy; say so and stop.
- FAIL: show the failing lines to `keyword-researcher`, fix the *inputs* (a missing KD row, a mislabelled file), never
  the thresholds. Changing a threshold is the owner's decision, recorded in `factory.config.json` with a reason.

## summary
From the output files (don't recompute by hand):
- counts: rows in, kept, rejected by reason (`low-volume`, `kd`, `seasonal`, `brand`, `duplicate`) [M];
- the page plan: URLs by type (tool, guide, hub, instance) and category, each with its primary keyword;
- anything the owner should look at: brand terms, seasonal seeds that were rejected, KD rows marked [U].
