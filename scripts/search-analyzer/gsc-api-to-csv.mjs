#!/usr/bin/env node
// Turns Search Console API results (saved from the Search Console MCP connector) into the CSV files a Search Console
// export folder has, so analyze.mjs reads API data and a manual export the same way. Zero dependencies (Node 22+).
//
// Usage:
//   node scripts/search-analyzer/gsc-api-to-csv.mjs --in <folder of JSON> --out <folder for CSV> [--range "Last 28 days"]
//
// Looks in --in for these files (each one is the saved result of one query_search_analytics call; any may be missing):
//   chart.json (dimension date), queries.json (query), pages.json (page), devices.json (device),
//   countries.json (country), appearance.json (searchAppearance)
// A file holds an array of rows, or an object with the array under rows / data / results. A row is
// { keys: [value], clicks, impressions, ctr, position } or has the value under its dimension name.
// CTR is always recomputed as clicks ÷ impressions, because connectors differ on fraction vs percent.
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
if (!args.in || !args.out) { console.error('usage: gsc-api-to-csv.mjs --in <folder of JSON> --out <folder for CSV> [--range "Last 28 days"]'); process.exit(2); }

const FILES = [
  { json: 'chart.json', dim: 'date', csv: 'Chart.csv', head: 'Date' },
  { json: 'queries.json', dim: 'query', csv: 'Queries.csv', head: 'Top queries' },
  { json: 'pages.json', dim: 'page', csv: 'Pages.csv', head: 'Top pages' },
  { json: 'devices.json', dim: 'device', csv: 'Devices.csv', head: 'Device' },
  { json: 'countries.json', dim: 'country', csv: 'Countries.csv', head: 'Country' },
  { json: 'appearance.json', dim: 'searchAppearance', csv: 'Search appearance.csv', head: 'Search appearance' },
];

const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rowsOf = (data) => (Array.isArray(data) ? data : data?.rows ?? data?.data ?? data?.results ?? []);
const keyOf = (r, dim) => (Array.isArray(r.keys) ? r.keys[0] : r[dim] ?? r.key ?? r.keys);

fs.mkdirSync(args.out, { recursive: true });
let wrote = 0;
for (const f of FILES) {
  const src = path.join(args.in, f.json);
  if (!fs.existsSync(src)) { console.log(`skip   ${f.csv}: ${f.json} not found`); continue; }
  let data;
  try { data = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) { console.error(`FAIL   ${f.json} is not JSON: ${e.message}`); process.exit(1); }
  const rows = rowsOf(data);
  const lines = [`${f.head},Clicks,Impressions,CTR,Position`];
  for (const r of rows) {
    const key = keyOf(r, f.dim);
    const clicks = Number(r.clicks ?? 0), impressions = Number(r.impressions ?? 0);
    if (key == null || key === '' || Number.isNaN(clicks) || Number.isNaN(impressions)) { console.error(`FAIL   ${f.json}: a row has no ${f.dim} or non-numeric clicks/impressions: ${JSON.stringify(r).slice(0, 120)}`); process.exit(1); }
    const ctr = impressions ? `${Math.round((clicks / impressions) * 10000) / 100}%` : '0%';
    const pos = r.position == null ? '' : Math.round(Number(r.position) * 100) / 100;
    lines.push([key, clicks, impressions, ctr, pos].map(cell).join(','));
  }
  fs.writeFileSync(path.join(args.out, f.csv), `${lines.join('\n')}\n`);
  console.log(`wrote  ${f.csv}: ${rows.length} rows${rows.length >= 1000 ? ' (1,000-row cap: the long tail may be cut off)' : ''}`);
  wrote++;
}
if (!wrote) { console.error('FAIL   no input JSON found in ' + args.in); process.exit(1); }
fs.writeFileSync(path.join(args.out, 'Filters.csv'), `Filter,Value\nSearch type,Web\nDate,${cell(args.range || 'API range (see work/api-pull.md)')}\n`);
console.log(`done: ${wrote} file(s) in ${args.out}. Source: Search Console API via MCP [M].`);
