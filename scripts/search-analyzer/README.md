# Search analyzer

Reads a Search Console export folder and two GA4 CSV exports, and writes a workbook, a report and four charts.
Zero dependencies: Node 22 or newer. Outputs go to `reports/search-analyzer/runs/`, which is git-ignored: exports and results are never committed.

## Run it

1. Build the site once so titles, schema and links can be read: `npm run build` (the script reads `out/`).
2. Export from Search Console: Performance → Export → Download CSV (unzip it).
3. Export from GA4: Reports snapshot → Share → Download CSV; and Search Console → Queries → Download CSV.
4. From the repo root:

```bash
node scripts/search-analyzer/analyze.mjs --gsc "<GSC export folder>" --ga4-snapshot "<Reports_snapshot.csv>" --ga4-queries "<Queries_Organic_Google_Search_query.csv>" --out reports/search-analyzer/runs/<yyyy-mm-dd>
```

Optional: `--query-page <csv>` (columns query, page, clicks, impressions, ctr, position) turns cannibalization and query-to-page mapping from inferred into measured. `--brand "a,b"` sets the brand terms. Hand-written actions go in `<out>/actions.extra.json`.

## Outputs (in the `--out` folder)

- `search-analysis.xlsx`: master action list (RICE), baseline, inventory, CTR curve, one tab per analysis A–O, clean tables.
- `report.html`: one short section per analysis, with the charts.
- `charts/`: trend, CTR vs position, opportunity bubbles, device and geography (SVG).
- `analysis.json` and `work/clean.json`: everything as data; `work/input/` holds the copies of the inputs.

Thresholds and the benchmark CTR curve are in the `CFG` block at the top of the script.

## Use it in another project

The script is project-neutral. Copy three things:

1. `scripts/search-analyzer/analyze.mjs`, `verify.mjs` and `gsc-api-to-csv.mjs` to the same path in the other repo.
2. `scripts/search-analyzer/agent-template.md` to `.claude/agents/search-analyst.md` in the other repo.
3. Add `reports/` to that repo's `.gitignore`.

Then adjust for the project:

- `--site-out <folder>`: the built static site with one `index.html` per route (default `out`). Without it the script still runs, but title joins, schema and link checks are skipped.
- `--domain` and `--brand`: read from the export and the domain name unless you pass them.
- `--registry <json>`: optional keyword plan, a list or map of rows with `url`, `status`, `type`, `primary`. Without it the backlog rows are skipped.
- Page types come from URL depth (`/` home, `/a/` hub, `/a/b/` page, `/a/b/c/` answer page) and the `STATIC` list near the top of the script; edit that list to match the site.
- The agent (`.claude/agents/search-analyst.md`) pulls Search Console data through the Search Console MCP connector first and writes it as CSVs with `gsc-api-to-csv.mjs`; if the connector is missing, signed out or out of quota it asks for the CSV exports instead. Copy `gsc-api-to-csv.mjs` with the other two scripts if the other repo uses a connector.
