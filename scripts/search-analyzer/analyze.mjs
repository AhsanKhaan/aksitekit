#!/usr/bin/env node
// Search Console + GA4 analyzer for a static site. Zero dependencies (Node 22+).
//
// Usage (from the repo root):
//   node scripts/search-analyzer/analyze.mjs \
//     --gsc "<GSC export folder>" \
//     --ga4-snapshot "<GA4 Reports snapshot csv>" \
//     --ga4-queries "<GA4 Queries: Organic Google Search query csv>" \
//     [--out reports/search-analyzer/runs/<name>] [--site-out out] [--registry content/keyword-map.json]
//     [--query-page "<csv with columns query,page,clicks,impressions,ctr,position>"]
//     [--device-query "<csv with columns query,device,clicks,impressions,ctr,position>"]
//     [--brand "my brand,mybrand"] [--domain example.com]
//
// --domain defaults to the host in the GSC Pages.csv; --brand defaults to the domain's first label (spaces are ignored
// when matching, so "my brand" and "mybrand" both count). --site-out is the built static site (index.html per route);
// --registry is an optional JSON list or map of rows with { url, status, type, primary } (a keyword plan).
//
// Inputs are copied to <out>/work/input first and never modified.
// Every number in the outputs is labelled: [M] measured, [R] range, [P] proxy/estimate, [U] unverified.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ───────────────────────── config (thresholds live here) ─────────────────────────
const CFG = {
  snippetGap: { minImpressions: 100, belowCurveBy: 0.30 },
  striking: { minPos: 8, maxPos: 20, targetPos: 4 },
  zeroClick: { minImpressions: 5, maxClicks: 1 },
  decay: { change: 0.25 },
  ownCurve: { minImpressions: 300, minClicks: 10 }, // a bucket needs both to be trusted
  spike: { dayFactor: 5, queryShare: 0.5 }, // a day > 5× the median day; a query > 50% of all impressions
  topN: 25,
  // Benchmark organic CTR by position [P][U]: Backlinko "Google CTR stats" (2023, about 4M results),
  // quoted from memory, NOT re-fetched on 2026-11-12 (the fetch failed). All query types, all sites.
  // Positions 11–20 are an assumption [P]. Replace with the site's own curve when it has support.
  benchmarkCtr: { 1: 0.276, 2: 0.158, 3: 0.110, 4: 0.084, 5: 0.063, 6: 0.049, 7: 0.039, 8: 0.033, 9: 0.027, 10: 0.024, 11: 0.010, 20: 0.005, 50: 0.001 },
  optimisticShareOfBenchmark: 0.5, // [P] assumption
};

// ───────────────────────── small helpers ─────────────────────────
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
if (!args.gsc) { console.error('Missing --gsc <folder>. See the usage notes at the top of this file.'); process.exit(2); }
const DOMAIN = (args.domain || (() => { try { return new URL(fs.readFileSync(path.join(args.gsc, 'Pages.csv'), 'utf8').split(/\r?\n/)[1].split(',')[0].replace(/^"/, '')).host; } catch { return ''; } })()).toLowerCase().replace(/^www\./, '');
if (!DOMAIN) { console.error('Could not read the domain from Pages.csv: pass --domain example.com'); process.exit(2); }
const BRAND = (args.brand || DOMAIN.split('.')[0]).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const OUT = path.resolve(args.out || `reports/search-analyzer/runs/${new Date().toLocaleDateString('en-CA')}`);
const SITE_OUT = args['site-out'] || 'out';
const REGISTRY = args.registry || 'content/keyword-map.json';
const WORK = path.join(OUT, 'work');
for (const d of [OUT, WORK, path.join(WORK, 'input'), path.join(OUT, 'charts')]) fs.mkdirSync(d, { recursive: true });

const warnings = [];
const warn = (m) => { warnings.push(m); };
const sum = (a, f) => a.reduce((s, r) => s + (f(r) || 0), 0);
const wavg = (a, f, w) => { const W = sum(a, w); return W ? sum(a, (r) => f(r) * w(r)) / W : null; };
const round = (n, d = 2) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (n, d = 2) => (n == null ? '' : `${round(n * 100, d)}%`);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");

function parseCsv(text) {
  const rows = []; let r = [], c = '', q = false;
  text = text.replace(/^\ufeff/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { r.push(c); c = ''; }
    else if (ch === '\n') { r.push(c); rows.push(r); r = []; c = ''; }
    else if (ch !== '\r') c += ch;
  }
  if (c || r.length) { r.push(c); rows.push(r); }
  return rows;
}
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[%,]/g, '')); return Number.isNaN(n) ? null : n; };
const ctrF = (v) => { if (v == null || v === '') return null; const s = String(v); return s.includes('%') ? num(s) / 100 : num(s); };
function normUrl(u) {
  let s = String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('#')[0].split('?')[0];
  if (s.startsWith(DOMAIN)) s = s.slice(DOMAIN.length);
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1 && !/\.[a-z0-9]+$/.test(s)) s = s.replace(/\/+$/, '') + '/';
  return s;
}
const STOP = new Set('a an the of in to for is it what whats how do i my and or as by on at from with me you does calculator calculate vs free online'.split(' '));
const tokens = (s) => String(s || '').toLowerCase().replace(/(\d)\s*\/\s*(-?\d)/g, '$1_$2').replace(/(\d)\s*[x×*]\s*(?=\d)/g, '$1 times ').replace(/÷/g, ' divided ').replace(/[^a-z0-9%$_]+/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));
function bench(pos) {
  const ks = Object.keys(CFG.benchmarkCtr).map(Number).sort((a, b) => a - b);
  if (pos <= ks[0]) return CFG.benchmarkCtr[ks[0]];
  for (let i = 1; i < ks.length; i++) if (pos <= ks[i]) { const a = ks[i - 1], b = ks[i]; return CFG.benchmarkCtr[a] + (CFG.benchmarkCtr[b] - CFG.benchmarkCtr[a]) * ((pos - a) / (b - a)); }
  return CFG.benchmarkCtr[ks.at(-1)];
}
const posBucket = (p) => (p == null ? 'n/a' : p <= 3.5 ? '1–3' : p <= 7.5 ? '4–7' : p <= 10.5 ? '8–10' : p <= 20.5 ? '11–20' : '21+');
const BUCKETS = ['1–3', '4–7', '8–10', '11–20', '21+'];

// ───────────────────────── step 0: copy + inventory ─────────────────────────
const inventory = [];
function load(src, label) {
  if (!src || !fs.existsSync(src)) { warn(`Input missing: ${label} (${src || 'not given'})`); return null; }
  const dest = path.join(WORK, 'input', path.basename(src));
  fs.copyFileSync(src, dest);
  return fs.readFileSync(dest, 'utf8');
}
function gscTable(file) {
  const text = load(path.join(args.gsc, file), `GSC ${file}`);
  if (text == null) return [];
  const rows = parseCsv(text).filter((r) => r.length > 1);
  const head = rows.shift() || [];
  const out = rows.map((r) => ({ key: r[0], clicks: num(r[1]) ?? 0, impressions: num(r[2]) ?? 0, ctr: ctrF(r[3]), position: num(r[4]) }));
  const issues = [];
  const bad = out.filter((r) => r.impressions > 0 && r.ctr != null && Math.abs(r.ctr - r.clicks / r.impressions) > 0.006).length;
  if (bad) issues.push(`${bad} rows where CTR ≠ clicks/impressions`);
  if (new Set(out.map((r) => r.key)).size !== out.length) issues.push('duplicate keys');
  if (out.length >= 1000) issues.push('1,000-row export cap reached: the long tail is cut off');
  inventory.push({ file: `GSC/${file}`, rows: out.length, columns: head.join(', '), dateRange: '', issues: issues.join('; ') || 'none' });
  return out;
}
const chart = gscTable('Chart.csv').map((r) => ({ date: r.key, ...r }));
const gscQueries = gscTable('Queries.csv');
const gscPages = gscTable('Pages.csv');
const gscDevices = gscTable('Devices.csv');
const gscCountries = gscTable('Countries.csv');
const gscAppearance = gscTable('Search appearance.csv');
const filtersText = load(path.join(args.gsc, 'Filters.csv'), 'GSC Filters.csv');
const gscFilters = filtersText ? Object.fromEntries(parseCsv(filtersText).slice(1).filter((r) => r.length > 1)) : {};
inventory.push({ file: 'GSC/Filters.csv', rows: Object.keys(gscFilters).length, columns: 'Filter, Value', dateRange: '', issues: Object.entries(gscFilters).map(([k, v]) => `${k}=${v}`).join('; ') });
const gscDates = chart.map((r) => r.date).sort();
const gscRange = { start: gscDates[0], end: gscDates.at(-1), days: chart.length };
for (const i of inventory) if (i.file === 'GSC/Chart.csv') { i.dateRange = `${gscRange.start} → ${gscRange.end} (${gscRange.days} days with a row)`; if (gscRange.days < 28 && /28/.test(gscFilters.Date || '')) i.issues = `only ${gscRange.days} daily rows for a "Last 28 days" export: the property has less than 28 days of data`; }

// GA4 snapshot: sections split by "#" comment blocks; each section is identified by its header row.
const ga4 = { range: {}, totals: {}, pages: [], firstUserSource: [], sessionSource: [], daily: [], cities: [], keyEvents: [] };
{
  const text = load(args['ga4-snapshot'], 'GA4 snapshot');
  if (text != null) {
    const s = text.match(/# Start date: (\d{8})/), e = text.match(/# End date: (\d{8})/);
    const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
    if (s && e) ga4.range = { start: iso(s[1]), end: iso(e[1]) };
    const blocks = text.split(/\r?\n/).reduce((acc, line) => { if (line.startsWith('#') || !line.trim()) { if (acc.at(-1).length) acc.push([]); } else acc.at(-1).push(line); return acc; }, [[]]).filter((b) => b.length);
    let n = 0;
    for (const b of blocks) {
      const rows = parseCsv(b.join('\n')); const head = rows.shift(); const h0 = head[0];
      n += rows.length;
      if (h0 === 'Active users') ga4.totals = { activeUsers: num(rows[0][0]), newUsers: num(rows[0][1]), avgEngagementSec: num(rows[0][2]), eventCount: num(rows[0][3]) };
      else if (/^Page title/.test(h0)) ga4.pages = rows.map((r) => ({ title: r[0], views: num(r[1]), activeUsers: num(r[2]), events: num(r[3]), bounceRate: num(r[4]) }));
      else if (/^First user source/.test(h0)) ga4.firstUserSource = rows.map((r) => ({ key: r[0], activeUsers: num(r[1]) }));
      else if (/^Session source/.test(h0)) ga4.sessionSource = rows.map((r) => ({ key: r[0], sessions: num(r[1]) }));
      else if (h0 === 'Nth day') ga4.daily = rows.map((r) => ({ nth: num(r[0]), new: num(r[1]), returning: num(r[2]) }));
      else if (h0 === 'City') ga4.cities = rows.map((r) => ({ key: r[0], activeUsers: num(r[1]) }));
      else if (h0 === 'Platform') ga4.keyEvents = rows.map((r) => ({ key: r[0], keyEvents: num(r[1]) }));
    }
    const issues = ['page report is keyed by page TITLE, not path (joined to URLs through the built site titles)', 'no per-page organic split', 'no event-name breakdown'];
    if (!ga4.keyEvents.length) issues.push('key-events section is empty: no key events are configured or none fired');
    inventory.push({ file: 'GA4/Reports snapshot', rows: n, columns: `${blocks.length} sections: totals, page titles, first-user source, session source, new vs returning by day, cities, key events`, dateRange: `${ga4.range.start} → ${ga4.range.end}`, issues: issues.join('; ') });
  }
}
let ga4Queries = [];
{
  const text = load(args['ga4-queries'], 'GA4 organic queries');
  if (text != null) {
    const rows = parseCsv(text.split(/\r?\n/).filter((l) => !l.startsWith('#') && l.trim()).join('\n')).filter((r) => r.length === 5);
    const head = rows.shift();
    ga4Queries = rows.map((r) => ({ key: r[0], clicks: num(r[1]) ?? 0, impressions: num(r[2]) ?? 0, ctr: ctrF(r[3]), position: num(r[4]) })).filter((r) => r.key);
    const s = text.match(/# Start date: (\d{8})/), e = text.match(/# End date: (\d{8})/);
    const quoted = ga4Queries.filter((r) => /^".*"$/.test(r.key)).length;
    inventory.push({ file: 'GA4/Queries (Search Console link)', rows: ga4Queries.length, columns: head.join(', '), dateRange: s && e ? `${s[1]} → ${e[1]}` : '', issues: `all countries (the GSC export is ${gscFilters.Country || 'unfiltered'}); ${quoted} exact-match queries in quotes (typical of rank-checking tools, not shoppers)` });
  }
}

// date overlap
const overlap = (() => {
  if (!gscRange.start || !ga4.range.start) return { ok: false, note: 'one of the date ranges is missing' };
  const a = Math.max(Date.parse(gscRange.start), Date.parse(ga4.range.start)), b = Math.min(Date.parse(gscRange.end), Date.parse(ga4.range.end));
  const days = Math.round((b - a) / 864e5) + 1;
  return { ok: days > 0, days, note: `GSC ${gscRange.start}→${gscRange.end}, GA4 ${ga4.range.start}→${ga4.range.end}: ${days > 0 ? `${days} days overlap` : 'NO overlap'}` };
})();
if (!overlap.ok) warn(`Date ranges do not overlap: ${overlap.note}`);

// ───────────────────────── step 1: site inventory (built pages) + registry ─────────────────────────
const site = new Map(); // url → { title, description, h1, h2[], types[], links[], canonical }
(function scan(dir, rel = '') {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('_next')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) scan(p, `${rel}/${ent.name}`);
    else if (ent.name === 'index.html') {
      const h = fs.readFileSync(p, 'utf8'); const url = normUrl(rel || '/');
      if (url === '/404/' || url.startsWith('/_')) continue;
      const types = [];
      for (const m of h.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)) {
        try { const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x['@type']) types.push(...[].concat(x['@type'])); if (x['@graph']) walk(x['@graph']); } }; walk(JSON.parse(m[1])); } catch { warn(`Unparseable JSON-LD on ${url}`); }
      }
      const strip = (s) => unesc(s.replace(/<[^>]+>/g, '')).trim();
      site.set(url, {
        url,
        title: unesc((h.match(/<title>(.*?)<\/title>/s) || [])[1] || ''),
        description: unesc((h.match(/<meta name="description" content="(.*?)"/s) || [])[1] || ''),
        h1: strip((h.match(/<h1[^>]*>(.*?)<\/h1>/s) || [])[1] || ''),
        h2: [...h.matchAll(/<h2[^>]*>(.*?)<\/h2>/gs)].map((m) => strip(m[1])),
        types: [...new Set(types)],
        robots: (h.match(/<meta name="robots" content="(.*?)"/) || [])[1] || '',
        canonical: (h.match(/<link rel="canonical" href="(.*?)"/) || [])[1] || '',
        links: [...new Set([...(h.split(/<main/)[1] || h).matchAll(/href="(\/[^"#?]*)"/g)].map((m) => normUrl(m[1])).filter((u) => !u.startsWith('/_next') && u !== url))],
      });
    }
  }
})(SITE_OUT);
if (!site.size) warn(`No built pages found in "${SITE_OUT}": run "npm run build" first, or pass --site-out. Title joins, schema and link checks are skipped.`);
const registry = new Map();
if (fs.existsSync(REGISTRY)) { for (const r of Object.values(JSON.parse(fs.readFileSync(REGISTRY, 'utf8')))) if (r && r.url) registry.set(normUrl(r.url), r); }
else if (args.registry) warn(`Registry not found at ${REGISTRY}`);

const STATIC = new Set(['about', 'contact', 'privacy', 'terms', 'methodology', 'editorial-policy', 'authors', 'calculators', 'cookies', 'disclaimer', 'disclosure']);
function pageMeta(url) {
  const seg = url.split('/').filter(Boolean); const reg = registry.get(url);
  let type;
  if (/\.[a-z0-9]+$/.test(url)) type = 'file';
  else if (!seg.length) type = 'home';
  else if (STATIC.has(seg[0])) type = 'static';
  else if (reg?.type === 'guide') type = 'guide';
  else if (seg.length === 1) type = 'hub';
  else if (seg.length === 2) type = 'calculator';
  else type = 'instance (answer page)';
  return { type, cluster: seg[0] || 'home', entity: seg.length >= 2 && type !== 'static' ? seg[1] : seg[0] || 'home' };
}

// ───────────────────────── step 1: clean tables ─────────────────────────
const isBrand = (q) => { const flat = q.toLowerCase().replace(/\s+/g, ''); return BRAND.some((b) => flat.includes(b.replace(/\s+/g, ''))); };
function intent(q) {
  const s = q.toLowerCase();
  if (/calculator|generator|counter|converter|\bcalc\b|\brng\b|picker/.test(s)) return 'calculator (tool)';
  if (/^(?:how|why|what is the formula|formula)|\bhow to\b|\bformula\b|\bsteps?\b|\bexplain/.test(s)) return 'how-to / formula';
  if (/\d/.test(s)) return 'direct answer (a specific sum)';
  return 'other';
}
const pages = gscPages.map((r) => { const url = normUrl(r.key); return { url, ...r, ...pageMeta(url), built: site.has(url), inRegistry: registry.has(url) }; });
const dup = pages.length - new Set(pages.map((p) => p.url)).size;
if (dup) warn(`${dup} GSC page rows collapse to the same normalized URL`);

// query → page: measured when --query-page is given, otherwise inferred by token match [P]
const pageIndex = [...new Set([...pages.map((p) => p.url), ...site.keys()])].map((url) => ({ url, hasImpr: pages.some((p) => p.url === url), toks: new Set([...(site.get(url)?.h1 && url.split('/').filter(Boolean).length > 2 ? [] : tokens(url.replace(/[/-]/g, ' '))), ...tokens(site.get(url)?.h1), ...tokens(registry.get(url)?.primary)]) }));
function inferPage(q) {
  const qt = tokens(q); if (!qt.length) return { url: null, score: 0, runnerUp: null };
  const score1 = (p) => qt.filter((t) => p.toks.has(t)).length / Math.sqrt(qt.length * Math.max(p.toks.size, 1));
  const pool = pageIndex.some((p) => p.hasImpr && score1(p) >= 0.35) ? pageIndex.filter((p) => p.hasImpr) : pageIndex; // Pages.csv says which URLs were shown at all
  const scored = pool.map((p) => { const hit = qt.filter((t) => p.toks.has(t)).length; return { url: p.url, score: hit / Math.sqrt(qt.length * Math.max(p.toks.size, 1)) }; }).sort((a, b) => b.score - a.score);
  return scored[0].score >= 0.35 ? { url: scored[0].url, score: round(scored[0].score), runnerUp: scored[1] && scored[1].score >= scored[0].score * 0.9 && scored[1].score >= 0.35 ? scored[1].url : null } : { url: null, score: round(scored[0].score), runnerUp: null };
}
let queryPage = null;
if (args['query-page'] && fs.existsSync(args['query-page'])) {
  const rows = parseCsv(load(args['query-page'], 'query×page')); const head = rows.shift().map((h) => h.toLowerCase());
  const ix = (n) => head.findIndex((h) => h.includes(n));
  queryPage = rows.filter((r) => r.length > 3).map((r) => ({ query: r[ix('query')], url: normUrl(r[ix('page')]), clicks: num(r[ix('click')]) ?? 0, impressions: num(r[ix('impr')]) ?? 0, position: num(r[ix('pos')]) }));
  inventory.push({ file: 'GSC/query×page (optional)', rows: queryPage.length, columns: head.join(', '), dateRange: '', issues: 'none' });
}
const measuredPage = (q) => { if (!queryPage) return null; const m = queryPage.filter((r) => r.query === q).sort((a, b) => b.impressions - a.impressions); return m.length ? m : null; };

const totalImpr = sum(gscCountries.length ? gscCountries : chart, (r) => r.impressions);
const totalClicks = sum(gscCountries.length ? gscCountries : chart, (r) => r.clicks);
const totalPos = wavg(chart.filter((r) => r.position != null), (r) => r.position, (r) => r.impressions);

const queries = gscQueries.map((r) => {
  const mp = measuredPage(r.key); const inf = inferPage(r.key);
  return { query: r.key, ...r, brand: isBrand(r.key), intent: intent(r.key), bucket: posBucket(r.position),
    page: mp ? mp[0].url : inf.url, pageSource: mp ? '[M]' : inf.url ? '[P] inferred' : 'none', matchScore: mp ? 1 : inf.score,
    otherPage: mp ? (mp[1]?.url ?? null) : inf.runnerUp, spikeSuspect: totalImpr > 0 && r.impressions / totalImpr > CFG.spike.queryShare };
});
for (const q of queries) { const pm = q.page ? pageMeta(q.page) : null; q.cluster = pm ? pm.cluster : 'unmapped'; q.entity = pm ? pm.entity : 'unmapped'; }

// hidden (anonymized) queries
const hidden = { clicks: totalClicks - sum(queries, (r) => r.clicks), impressions: totalImpr - sum(queries, (r) => r.impressions) };
// spike days
const allDayMedian = median(chart.filter((r) => r.impressions > 0).map((r) => r.impressions));
const spikeDays = chart.filter((r) => r.impressions > allDayMedian * CFG.spike.dayFactor);
const dayMedian = median(chart.filter((r) => r.impressions > 0 && !spikeDays.includes(r)).map((r) => r.impressions));
const spikeImpr = sum(spikeDays, (r) => r.impressions);
const runRateMonthly = round(dayMedian * 28, 0); // [P] median active day × 28

// GA4 title → URL
const titleIndex = [...site.values()].map((p) => ({ url: p.url, title: p.title.toLowerCase(), toks: new Set(tokens(`${p.title} ${p.h1}`)) }));
function titleToUrl(t) {
  const low = t.toLowerCase();
  if (/page not found/.test(low)) return { url: '(404)', how: 'rule' };
  const exact = titleIndex.find((p) => p.title === low || p.title.replace(/ [|–-] [^|–-]+$/, '') === low || low.replace(/ [|–-] [^|–-]+$/, '') === p.title);
  if (exact) return { url: exact.url, how: 'exact title' };
  const tt = tokens(t); let best = null;
  for (const p of titleIndex) { const hit = tt.filter((x) => p.toks.has(x)).length; const sc = hit / Math.sqrt(Math.max(tt.length, 1) * Math.max(p.toks.size, 1)); if (!best || sc > best.sc) best = { url: p.url, sc }; }
  if (best && best.sc >= 0.6) return { url: best.url, how: `fuzzy ${round(best.sc)} [P]` };
  const hub = [...site.keys()].find((u) => { const seg = u.split('/').filter(Boolean); return seg.length === 1 && /calculators/i.test(t) && tokens(seg[0].replace(/-/g, ' ')).some((x) => tt.includes(x)); });
  return hub ? { url: hub, how: 'old hub title [P]' } : { url: null, how: 'unmatched' };
}
const ga4Pages = ga4.pages.map((p) => ({ ...p, ...titleToUrl(p.title) }));
const ga4ByUrl = new Map();
for (const p of ga4Pages) { if (!p.url) continue; const c = ga4ByUrl.get(p.url) || { views: 0, activeUsers: 0, events: 0, bounces: 0, titles: [] }; c.views += p.views; c.activeUsers += p.activeUsers; c.events += p.events; c.bounces += (p.bounceRate ?? 0) * p.activeUsers; c.titles.push(p.title); ga4ByUrl.set(p.url, c); }
for (const c of ga4ByUrl.values()) c.engagementRate = c.activeUsers ? 1 - c.bounces / c.activeUsers : null; // [P] user-weighted, sessions not exported
const ga4Unmatched = ga4Pages.filter((p) => !p.url);
if (ga4Unmatched.length) warn(`${ga4Unmatched.length} GA4 page titles could not be matched to a URL`);

// joined page table
const allUrls = [...new Set([...pages.map((p) => p.url), ...site.keys(), ...ga4ByUrl.keys()])].filter((u) => u !== '(404)');
const joined = allUrls.map((url) => {
  const g = pages.find((p) => p.url === url); const a = ga4ByUrl.get(url); const s = site.get(url); const pm = pageMeta(url);
  return { url, ...pm, impressions: g?.impressions ?? 0, clicks: g?.clicks ?? 0, ctr: g && g.impressions ? g.clicks / g.impressions : null, position: g?.position ?? null,
    ga4Views: a?.views ?? 0, ga4Users: a?.activeUsers ?? 0, ga4Events: a?.events ?? 0, engagementRate: a?.engagementRate ?? null, eventsPerUser: a && a.activeUsers ? a.events / a.activeUsers : null,
    inGsc: !!g, inGa4: !!a, built: !!s, inRegistry: registry.has(url), title: s?.title ?? '', titleLen: s?.title.length ?? null, descLen: s?.description.length ?? null, schema: s?.types.join(', ') ?? '',
    inlinks: [...site.values()].filter((o) => o.links.includes(url)).length };
});
fs.writeFileSync(path.join(WORK, 'clean.json'), JSON.stringify({ gscRange, ga4Range: ga4.range, chart, queries, pages, joined, ga4, ga4Queries, gscDevices, gscCountries, gscAppearance }, null, 1));

// ───────────────────────── CTR curve + scenarios ─────────────────────────
const curve = BUCKETS.map((b) => {
  const rows = queries.filter((q) => q.bucket === b); const impr = sum(rows, (r) => r.impressions), clicks = sum(rows, (r) => r.clicks);
  const p = wavg(rows, (r) => r.position, (r) => r.impressions);
  const trusted = impr >= CFG.ownCurve.minImpressions && clicks >= CFG.ownCurve.minClicks;
  return { bucket: b, queries: rows.length, impressions: impr, clicks, ownCtr: impr ? clicks / impr : null, weightedPosition: round(p), benchmarkCtr: p ? bench(p) : null, trusted, used: trusted ? 'own [M]' : 'benchmark [P]' };
});
// realisation factor: how much of the benchmark the site actually gets (own data, tiny sample)
const expClicksBench = (rows) => sum(rows, (r) => r.impressions * bench(r.position ?? 50));
const rfAll = sum(queries, (r) => r.clicks) / (expClicksBench(queries) || 1);
const noSpike = queries.filter((q) => !q.spikeSuspect);
const rfNoSpike = sum(noSpike, (r) => r.clicks) / (expClicksBench(noSpike) || 1);
// 95% Poisson interval on the observed click count (exact for 0–5, normal approx above)
const POIS = { 0: [0, 3.69], 1: [0.03, 5.57], 2: [0.24, 7.22], 3: [0.62, 8.77], 4: [1.09, 10.24], 5: [1.62, 11.67] };
const ci = (k) => POIS[k] || [k - 1.96 * Math.sqrt(k), k + 1.96 * Math.sqrt(k)];
const scen = {
  conservative: { factor: Math.min(rfAll, rfNoSpike), basis: 'own clicks ÷ benchmark-expected clicks, all queries [M÷P]' },
  expected: { factor: Math.max(rfAll, rfNoSpike), basis: 'the same ratio without the spike query [M÷P]' },
  optimistic: { factor: CFG.optimisticShareOfBenchmark, basis: `${CFG.optimisticShareOfBenchmark * 100}% of the benchmark [P] assumption` },
};
const expCtr = (pos, s) => { const b = curve.find((c) => c.bucket === posBucket(pos)); return b?.trusted ? b.ownCtr : bench(pos) * scen[s].factor; };
const gain = (impr, clicks, pos, s) => Math.max(0, impr * expCtr(pos, s) - clicks);
const gains = (impr, clicks, pos) => ({ gainLow: round(gain(impr, clicks, pos, 'conservative'), 1), gainExp: round(gain(impr, clicks, pos, 'expected'), 1), gainHigh: round(gain(impr, clicks, pos, 'optimistic'), 1) });

// ───────────────────────── step 2: baseline ─────────────────────────
const half = Math.floor(chart.length / 2);
const firstHalf = chart.slice(0, half), secondHalf = chart.slice(half);
const organicSessions = sum(ga4.sessionSource.filter((r) => /organic/.test(r.key)), (r) => r.sessions);
const googleOrganicSessions = sum(ga4.sessionSource.filter((r) => /^google \/ organic/.test(r.key)), (r) => r.sessions);
const totalSessions = sum(ga4.sessionSource, (r) => r.sessions);
const gaUsers = ga4.totals.activeUsers || 0;
const topCity = [...ga4.cities].sort((a, b) => b.activeUsers - a.activeUsers)[0];
const brandRows = queries.filter((q) => q.brand);
const baseline = [
  ['GSC impressions', totalImpr, '[M]', `Countries.csv total; filter: ${gscFilters.Country || 'all countries'}`],
  ['GSC clicks', totalClicks, '[M]', 'Countries.csv total'],
  ['GSC CTR', pct(totalClicks / totalImpr), '[M]', 'clicks ÷ impressions (not an average of row CTRs)'],
  ['GSC position (impression-weighted)', round(totalPos), '[M]', 'Chart.csv daily positions weighted by impressions'],
  ['Days with impressions', chart.filter((r) => r.impressions > 0).length, '[M]', `first: ${chart.find((r) => r.impressions > 0)?.date}`],
  ['Impressions on spike days', `${spikeImpr} (${pct(spikeImpr / totalImpr, 1)})`, '[M]', `${spikeDays.map((d) => d.date.slice(5)).join(', ')}; a spike day is > ${CFG.spike.dayFactor}× the median day (${allDayMedian})`],
  ['Run-rate impressions per 28 days', runRateMonthly, '[P]', `median non-spike day with impressions (${dayMedian}) × 28`],
  ['Queries shown / hidden impressions', `${queries.length} / ${hidden.impressions} (${pct(hidden.impressions / totalImpr, 1)})`, '[M]', `anonymized queries; hidden clicks: ${hidden.clicks}`],
  ['Branded clicks / impressions', `${sum(brandRows, (r) => r.clicks)} / ${sum(brandRows, (r) => r.impressions)}`, '[M]', `brand terms: ${BRAND.slice(0, 3).join(', ')}…`],
  ['Period over period (2nd half vs 1st half of the chart)', `impressions ${sum(firstHalf, (r) => r.impressions)} → ${sum(secondHalf, (r) => r.impressions)}; clicks ${sum(firstHalf, (r) => r.clicks)} → ${sum(secondHalf, (r) => r.clicks)}`, '[M]', 'no previous 28 days exist: the property is younger than the window'],
  ['GA4 active users / new users', `${gaUsers} / ${ga4.totals.newUsers ?? ''}`, '[M]', `GA4 ${ga4.range.start} → ${ga4.range.end}`],
  ['GA4 sessions (all) / organic / google organic', `${totalSessions} / ${organicSessions} / ${googleOrganicSessions}`, '[M]', 'Session source / medium'],
  ['GA4 avg engagement time per active user', `${round(ga4.totals.avgEngagementSec, 1)} s`, '[M]', 'all traffic, not organic only'],
  ['GA4 engagement rate (all pages)', pct(1 - (wavg(ga4.pages, (r) => r.bounceRate ?? 0, (r) => r.activeUsers) ?? 0), 1), '[P]', '1 − bounce rate, weighted by active users per page title'],
  ['GA4 key events', ga4.keyEvents.length ? sum(ga4.keyEvents, (r) => r.keyEvents) : 'none in the export', '[M]', 'the key-events section of the snapshot is empty'],
  ['GA4 calculator-interaction events', 'not in the export', '[U]', 'needs the GA4 Events report (event name × page)'],
  [`GA4 users in ${topCity?.key ?? 'top city'}`, `${topCity?.activeUsers ?? ''} of ${gaUsers} (${pct((topCity?.activeUsers ?? 0) / (gaUsers || 1), 0)})`, '[M]', 'if this is the owner, real visitors are fewer'],
  ['Date overlap', overlap.note, '[M]', overlap.ok ? 'ok' : 'WARNING'],
];
const clusters = Object.values(queries.reduce((a, q) => { const k = `${q.cluster} / ${q.entity}`; a[k] ??= { cluster: k, queries: 0, impressions: 0, clicks: 0, _p: 0 }; a[k].queries++; a[k].impressions += q.impressions; a[k].clicks += q.clicks; a[k]._p += (q.position ?? 0) * q.impressions; return a; }, {}))
  .map((c) => ({ cluster: c.cluster, queries: c.queries, impressions: c.impressions, clicks: c.clicks, ctr: pct(c.impressions ? c.clicks / c.impressions : 0), position: round(c._p / (c.impressions || 1)) })).sort((a, b) => b.impressions - a.impressions);

// ───────────────────────── step 3: analyses ─────────────────────────
const top = (rows, n = CFG.topN) => rows.slice(0, n);
const qRow = (q, extra = {}) => ({ item: q.query, page: q.page ?? '', impressions: q.impressions, clicks: q.clicks, ctr: pct(q.ctr ?? 0), position: q.position, ...extra });
const A = {}; // analysis id → { title, method, rows, soWhat, label }

// A snippet gap
{
  const cand = queries.filter((q) => q.impressions > CFG.snippetGap.minImpressions).map((q) => { const e = expCtr(q.position, 'expected'); return { q, e, gap: e ? 1 - (q.ctr ?? 0) / e : 0 }; }).filter((x) => x.gap > CFG.snippetGap.belowCurveBy);
  const candPages = pages.filter((p) => p.impressions > CFG.snippetGap.minImpressions).map((p) => { const e = expCtr(p.position, 'expected'); return { p, e, gap: e ? 1 - (p.ctr ?? 0) / e : 0 }; }).filter((x) => x.gap > CFG.snippetGap.belowCurveBy);
  A.A = { title: 'A. Snippet gap', method: `CTR more than ${CFG.snippetGap.belowCurveBy * 100}% below the expected CTR for the position, with more than ${CFG.snippetGap.minImpressions} impressions. Expected CTR = own curve where a bucket has ≥ ${CFG.ownCurve.minImpressions} impressions and ≥ ${CFG.ownCurve.minClicks} clicks; otherwise benchmark × the site's realisation factor. Gain = impressions × expected CTR − clicks, at the same position.`,
    rows: [...cand.map(({ q, e, gap }) => qRow(q, { kind: 'query', expectedCtr: pct(e), gap: pct(gap, 0), ...gains(q.impressions, q.clicks, q.position), spike: q.spikeSuspect ? 'yes' : '' })), ...candPages.map(({ p, e, gap }) => ({ item: p.url, page: p.url, impressions: p.impressions, clicks: p.clicks, ctr: pct(p.ctr ?? 0), position: p.position, kind: 'page', expectedCtr: pct(e), gap: pct(gap, 0), ...gains(p.impressions, p.clicks, p.position), spike: '' }))] };
}
// B striking distance
{
  const rows = queries.filter((q) => q.position >= CFG.striking.minPos && q.position <= CFG.striking.maxPos && !q.brand).map((q) => { const j = joined.find((p) => p.url === q.page); const t = CFG.striking.targetPos;
    return qRow(q, { clicksAtPos4_low: round(q.impressions * expCtr(t, 'conservative'), 1), clicksAtPos4_exp: round(q.impressions * expCtr(t, 'expected'), 1), clicksAtPos4_high: round(q.impressions * expCtr(t, 'optimistic'), 1), pageSource: q.pageSource, ga4Views: j?.ga4Views ?? '', engagementRate: j?.engagementRate != null ? pct(j.engagementRate, 0) : '', spike: q.spikeSuspect ? 'yes' : '' }); }).sort((a, b) => b.impressions - a.impressions);
  A.B = { title: 'B. Striking distance', method: `Non-branded queries at positions ${CFG.striking.minPos}–${CFG.striking.maxPos}. Clicks if the page reached position ${CFG.striking.targetPos} = impressions × expected CTR at ${CFG.striking.targetPos} (three scenarios). Impressions are assumed constant, which is wrong for the spike query.`, rows, total: rows.length };
}
// C zero-click
{
  const rows = queries.filter((q) => q.impressions >= CFG.zeroClick.minImpressions && q.clicks <= CFG.zeroClick.maxClicks).sort((a, b) => b.impressions - a.impressions).map((q) => qRow(q, { intent: q.intent, bucket: q.bucket }));
  const byIntent = Object.values(queries.reduce((a, q) => { a[q.intent] ??= { intent: q.intent, queries: 0, impressions: 0, clicks: 0 }; a[q.intent].queries++; a[q.intent].impressions += q.impressions; a[q.intent].clicks += q.clicks; return a; }, {})).sort((a, b) => b.impressions - a.impressions);
  A.C = { title: 'C. Zero-click impressions', method: `Queries with ≥ ${CFG.zeroClick.minImpressions} impressions and ≤ ${CFG.zeroClick.maxClicks} click, with intent classified by rule (tool words → calculator; "how/formula/steps" → how-to; a query with digits → direct answer).`, rows, byIntent };
}
// D cannibalization
{
  const rows = queryPage
    ? Object.values(queryPage.reduce((a, r) => { (a[r.query] ??= []).push(r); return a; }, {})).filter((g) => g.length > 1).map((g) => { g.sort((x, y) => y.impressions - x.impressions); return { item: g[0].query, urls: g.length, primary: g[0].url, primaryImpressions: g[0].impressions, primaryPosition: g[0].position, second: g[1].url, secondImpressions: g[1].impressions, secondPosition: g[1].position, source: '[M]' }; }).sort((a, b) => b.primaryImpressions + b.secondImpressions - a.primaryImpressions - a.secondImpressions)
    : queries.filter((q) => q.otherPage).sort((a, b) => b.impressions - a.impressions).map((q) => ({ item: q.query, impressions: q.impressions, position: q.position, primary: q.page, second: q.otherPage, source: '[P] candidate by word overlap, not measured' }));
  A.D = { title: 'D. Cannibalization', method: queryPage ? 'Measured: queries with two or more URLs in the query×page data.' : 'NOT MEASURABLE from these CSVs (no query×page pairing). The table lists candidates only: queries whose words match two built pages almost equally well. Pass --query-page to measure.', rows, measured: !!queryPage };
}
// E coverage gaps
{
  const unm = queries.filter((q) => !q.page || q.matchScore < 0.5).sort((a, b) => b.impressions - a.impressions).map((q) => qRow(q, { intent: q.intent, matchScore: q.matchScore, registryRow: [...registry.values()].find((r) => tokens(r.primary).join(' ') === tokens(q.query).join(' '))?.status ?? '' }));
  const gaOnly = ga4Queries.filter((g) => !gscQueries.some((q) => q.key === g.key)).map((g) => ({ ...g, inf: inferPage(g.key) })).sort((a, b) => b.impressions - a.impressions);
  const queued = [...registry.values()].filter((r) => r.status === 'queue').length;
  A.E = { title: 'E. Coverage gaps', method: 'Queries with impressions whose words match no built page well (score < 0.5), plus queries that appear only in the GA4 (all-country) export. A registry status is shown when the query equals a registry row\'s primary keyword.', rows: unm, gaOnly: top(gaOnly.map((g) => ({ item: g.key, impressions: g.impressions, clicks: g.clicks, position: round(g.position, 1), page: g.inf.url ?? '', note: /^".*"$/.test(g.key) ? 'exact-match query (tool-like)' : '' }))), queued };
}
// F page quality
{
  const withGa = joined.filter((p) => p.inGa4);
  const medEng = median(withGa.filter((p) => p.engagementRate != null).map((p) => p.engagementRate));
  const rows = joined.filter((p) => p.inGa4 || p.inGsc).map((p) => ({ item: p.url, type: p.type, impressions: p.impressions, clicks: p.clicks, position: p.position ?? '', ga4Views: p.ga4Views, ga4Users: p.ga4Users, engagementRate: p.engagementRate != null ? pct(p.engagementRate, 0) : '', eventsPerUser: round(p.eventsPerUser, 1) ?? '',
    flag: p.clicks > 0 && p.engagementRate != null && p.engagementRate < medEng ? 'clicks but weak engagement' : p.ga4Users >= 3 && p.engagementRate >= medEng && p.impressions < 10 && /calculator|instance|guide/.test(p.type) ? 'engaged visitors, low visibility' : p.ga4Users >= 3 && p.engagementRate != null && p.engagementRate < 0.5 ? 'weak engagement' : '' })).sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0) || b.ga4Views - a.ga4Views);
  A.F = { title: 'F. Page quality (GSC × GA4)', method: `GSC pages joined to GA4 page titles through the built site's <title> tags. Engagement rate = 1 − bounce rate [P]. Flags: clicks with engagement below the median (${pct(medEng, 0)}); ≥ 3 users with engagement at or above the median but < 10 impressions; ≥ 3 users with engagement under 50%. GA4 numbers are all traffic, not organic only.`, rows };
}
// G decay and growth
{
  const rows = chart.map((r) => ({ item: r.date, impressions: r.impressions, clicks: r.clicks, position: r.position ?? '', spike: spikeDays.includes(r) ? 'spike' : '' }));
  const post = chart.filter((r) => r.date > (spikeDays.at(-1)?.date ?? '') && r.impressions > 0);
  A.G = { title: 'G. Decay and growth', method: `Daily totals only: the CSVs have no per-query or per-page dates, so "down > ${CFG.decay.change * 100}%" cannot be computed per item. Spike days are > ${CFG.spike.dayFactor}× the median day.`, rows,
    stats: { spikeDays: spikeDays.map((d) => d.date), spikeImpr, afterSpikeMedian: median(post.map((r) => r.impressions)), afterSpikePos: round(wavg(post, (r) => r.position, (r) => r.impressions)), spikePos: round(wavg(spikeDays, (r) => r.position, (r) => r.impressions)), lastDays: chart.slice(-3).map((r) => `${r.date.slice(5)}: ${r.impressions}`) } };
}
// H device
A.H = { title: 'H. Device gap', method: 'Site-level only (Devices.csv). Device × query needs the API or a filtered export.', rows: gscDevices.map((d) => ({ item: d.key, impressions: d.impressions, clicks: d.clicks, ctr: pct(d.ctr ?? 0), position: d.position, shareOfImpressions: pct(d.impressions / (totalImpr || 1), 1), benchmarkCtrAtPosition: pct(bench(d.position)) })) };
// I geo
{
  const gaAll = { impressions: sum(ga4Queries, (r) => r.impressions), clicks: sum(ga4Queries, (r) => r.clicks) };
  A.I = { title: 'I. Geo gap', method: `The GSC export is filtered to ${gscFilters.Country || '(no filter)'}, so only that country is measured. The GA4 query export is all countries; its total minus the GSC query total is a rough [P] size of non-US demand among visible queries (both lose anonymized queries).`,
    rows: [...gscCountries.map((c) => ({ item: `GSC: ${c.key}`, impressions: c.impressions, clicks: c.clicks, ctr: pct(c.ctr ?? 0), position: c.position })), { item: 'GA4 visible queries, all countries', impressions: gaAll.impressions, clicks: gaAll.clicks, ctr: pct(gaAll.clicks / (gaAll.impressions || 1)), position: round(wavg(ga4Queries, (r) => r.position, (r) => r.impressions)) }, { item: 'GSC visible queries, US', impressions: sum(queries, (r) => r.impressions), clicks: sum(queries, (r) => r.clicks), ctr: '', position: '' }],
    cities: ga4.cities.map((c) => ({ item: c.key, activeUsers: c.activeUsers })) };
}
// J schema
{
  const rows = [...site.values()].map((p) => { const pm = pageMeta(p.url); const has = (t) => p.types.includes(t); const g = pages.find((x) => x.url === p.url);
    return { item: p.url, type: pm.type, impressions: g?.impressions ?? 0, breadcrumb: has('BreadcrumbList') ? 'yes' : p.url === '/' ? 'n/a' : 'MISSING', faqPage: has('FAQPage') ? 'yes' : 'no', appSchema: has('WebApplication') || has('SoftwareApplication') ? 'yes' : 'no', allTypes: p.types.join(', ') }; }).sort((a, b) => b.impressions - a.impressions);
  A.J = { title: 'J. Schema and rich results', method: 'JSON-LD @type values read from the built HTML in out/. What Google currently shows for each type must be checked against Search Central on the day (see the report).', rows, appearance: gscAppearance };
}
// K tracking and index gaps
{
  const rows = joined.filter((p) => p.built || p.inGsc || p.inGa4).map((p) => ({ item: p.url, type: p.type, built: p.built ? 'yes' : 'NO', inRegistry: p.inRegistry ? 'yes' : '', inGsc: p.inGsc ? 'yes' : 'no', impressions: p.impressions, inGa4: p.inGa4 ? 'yes' : 'no', ga4Views: p.ga4Views,
    flag: !p.built && p.inGsc ? 'in Search but not a built page' : p.built && !p.inGsc && !p.inGa4 ? 'no impressions and no visits' : p.built && !p.inGsc ? 'visited but no impressions' : p.built && !p.inGa4 ? 'impressions but no recorded visit' : '' })).sort((a, b) => (a.flag > b.flag ? -1 : a.flag < b.flag ? 1 : b.impressions - a.impressions));
  const notFound = ga4Pages.find((p) => p.url === '(404)');
  A.K = { title: 'K. Tracking and index gaps', method: 'Built pages (out/) vs pages with impressions (GSC Pages.csv) vs pages with visits (GA4 titles). "No impressions" is not the same as "not indexed": index status needs URL Inspection.', rows, counts: { built: site.size, withImpressions: pages.length, builtWithImpressions: joined.filter((p) => p.built && p.inGsc).length, builtNoImprNoVisit: rows.filter((r) => r.flag === 'no impressions and no visits').length, builtNoImpr: rows.filter((r) => r.built === 'yes' && r.inGsc === 'no').length, calculatorsNoImpr: rows.filter((r) => r.built === 'yes' && r.inGsc === 'no' && r.type === 'calculator').map((r) => r.item) }, notFound, unmatchedTitles: ga4Unmatched.map((p) => p.title) };
}
// L internal linking
{
  const targets = [...new Set(queries.filter((q) => q.page && q.position >= CFG.striking.minPos && q.position <= CFG.striking.maxPos).map((q) => q.page))];
  const strong = joined.filter((p) => p.built).sort((a, b) => b.ga4Views + b.inlinks - (a.ga4Views + a.inlinks));
  const rows = [];
  for (const t of targets) { const tm = pageMeta(t); const tj = joined.find((p) => p.url === t); if (!site.has(t)) continue;
    const missing = strong.filter((s) => s.url !== t && !site.get(s.url).links.includes(t) && (tm.type === 'calculator' ? (s.cluster === tm.cluster && s.type !== 'instance (answer page)') || s.type === 'home' || s.url === '/calculators/' : s.entity === tm.entity || (s.cluster === tm.cluster && s.type === 'calculator'))).slice(0, 3);
    for (const s of missing) rows.push({ item: t, impressions: tj.impressions, position: tj.position ?? '', inlinks: tj.inlinks, from: s.url, fromViews: s.ga4Views, fromType: s.type, anchor: site.get(t).h1 || registry.get(t)?.name || '' }); }
  rows.sort((a, b) => b.impressions - a.impressions);
  const hubs = [...site.values()].filter((p) => pageMeta(p.url).type === 'hub').map((h) => { const kids = [...site.keys()].filter((u) => u.startsWith(h.url) && u !== h.url && pageMeta(u).type === 'calculator'); const miss = kids.filter((k) => !h.links.includes(k)); return { item: h.url, calculators: kids.length, linked: kids.length - miss.length, missing: miss.join(' ') || 'none', hasRelatedHeading: h.h2.some((x) => /related/i.test(x)) ? 'yes' : 'no' }; });
  const orphans = joined.filter((p) => p.built && p.inlinks <= 1 && p.url !== '/').map((p) => ({ item: p.url, inlinks: p.inlinks, impressions: p.impressions }));
  A.L = { title: 'L. Internal linking', method: 'Link graph from the <main> part of each built page. For each page ranking at positions 8–20, the strongest pages in the same category (by GA4 views + inlinks), the home page and the A–Z page that do not link to it yet.', rows, hubs, orphans };
}
A.M = { title: 'M. Technical and Core Web Vitals', method: 'Not measured by this script. Field data (CrUX) does not exist for a site with this little traffic; lab data comes from the performance-auditor agent on the production build.', rows: [] };
A.N = { title: 'N. Competitive gap', method: 'Not run: it needs SERP or Semrush data. The table lists the non-branded clusters that would be checked first.', rows: top(clusters.filter((c) => !/unmapped/.test(c.cluster)), 10).map((c) => ({ item: c.cluster, queries: c.queries, impressions: c.impressions, clicks: c.clicks, position: c.position })) };
A.O = { title: 'O. Brand dependence', method: `Queries containing: ${BRAND.join(', ')}.`, rows: [{ item: 'branded', queries: brandRows.length, impressions: sum(brandRows, (r) => r.impressions), clicks: sum(brandRows, (r) => r.clicks) }, { item: 'non-branded', queries: queries.length - brandRows.length, impressions: sum(queries, (r) => r.impressions) - sum(brandRows, (r) => r.impressions), clicks: sum(queries, (r) => r.clicks) - sum(brandRows, (r) => r.clicks) }, { item: 'hidden (anonymized)', queries: '', impressions: hidden.impressions, clicks: hidden.clicks }] };

// ───────────────────────── upside totals (three scenarios) ─────────────────────────
// Per query: clicks if every position-8–20 query reached the target position, plus the snippet gap for
// queries already above position 8. The spike query is counted only at the run-rate volume left after all other queries, which can be zero.
// the spike query keeps only what the run-rate leaves after every other query (visible and hidden) is counted
const otherImpr = totalImpr - sum(queries.filter((q) => q.spikeSuspect), (q) => q.impressions);
const scaleRun = (q) => (q.spikeSuspect ? Math.min(1, Math.max(0, runRateMonthly - otherImpr) / (q.impressions || 1)) : 1);
const upside = Object.fromEntries(['conservative', 'expected', 'optimistic'].map((s) => {
  const strike = sum(queries.filter((q) => q.position >= CFG.striking.minPos && q.position <= CFG.striking.maxPos), (q) => Math.max(0, q.impressions * scaleRun(q) * expCtr(CFG.striking.targetPos, s) - q.clicks));
  const snip = sum(queries.filter((q) => q.position < CFG.striking.minPos), (q) => gain(q.impressions, q.clicks, q.position, s));
  const strikeSpike = sum(queries.filter((q) => q.position >= CFG.striking.minPos && q.position <= CFG.striking.maxPos), (q) => Math.max(0, q.impressions * expCtr(CFG.striking.targetPos, s) - q.clicks));
  return [s, { factor: round(scen[s].factor, 4), strikingRunRate: round(strike, 1), snippet: round(snip, 1), total: round(strike + snip, 1), ifSpikeRecurs: round(strikeSpike + snip, 1) }];
}));

// ───────────────────────── RICE action list ─────────────────────────
// Impact = estimated extra clicks per 28 days (expected scenario) [P]; Confidence 1 / 0.5 / 0.25; Effort S=1, M=3, L=8.
// The list is rule-generated from the tables above; add hand-written actions in <out>/actions.extra.json.
const actions = [];
const act = (o) => actions.push(o);
const conf = { high: 1, med: 0.5, low: 0.25 }, eff = { S: 1, M: 3, L: 8 };
{
  const byPage = {};
  for (const q of queries.filter((x) => x.page && x.position >= CFG.striking.minPos && x.position <= CFG.striking.maxPos)) { const b = (byPage[q.page] ??= { impr: 0, low: 0, exp: 0, high: 0, n: 0, top: q.query }); const k = scaleRun(q); b.n++; b.impr += q.impressions; for (const [s, key] of [['conservative', 'low'], ['expected', 'exp'], ['optimistic', 'high']]) b[key] += Math.max(0, q.impressions * k * expCtr(CFG.striking.targetPos, s) - q.clicks); }
  const small = Object.entries(byPage).filter(([, b]) => b.exp < 0.5);
  if (small.length) act({ action: `Leave the other ${small.length} pages at positions 8–20 as they are and re-check next month: too few impressions to matter yet`, analysis: 'B', target: small.map(([u]) => u).join(' '), evidence: `${sum(small, ([, b]) => b.impr)} impressions in total [M]`, impactLow: round(sum(small, ([, b]) => b.low), 1), impact: round(sum(small, ([, b]) => b.exp), 1), impactHigh: round(sum(small, ([, b]) => b.high), 1), confidence: 'low', effort: 'S', horizon: 'watch' });
  for (const [url, b] of Object.entries(byPage).filter(([, x]) => x.exp >= 0.5)) act({ action: `Move ${url} from page-1-bottom to positions 3–5: internal links from the pages in tab L, and (after the 12-week rule allows) content that answers its ${b.n} ranking queries`, analysis: 'B, L', target: url, evidence: `${b.n} queries at positions 8–20, ${b.impr} impressions [M]; top query "${b.top}"`, impactLow: round(b.low, 1), impact: round(b.exp, 1), impactHigh: round(b.high, 1), confidence: 'low', effort: 'S', horizon: 'quick win (<1 week) for links; medium for content' });
  if (!ga4.keyEvents.length) act({ action: 'In GA4, mark the calculator-use event (calculator_used) as a key event and export Events by page, so engagement and conversions can be measured', analysis: 'F, K', target: 'GA4 property', evidence: 'key-events section is empty [M]', impactLow: 0, impact: 0, impactHigh: 0, confidence: 'high', effort: 'S', horizon: 'quick win (<1 week)' });
  if (A.K.notFound) act({ action: `Find the URLs behind ${A.K.notFound.views} "Page not found" views (GA4 → Pages and screens by path, filter title) and fix or redirect the links that lead to them`, analysis: 'K', target: '404 page', evidence: `${A.K.notFound.views} views, ${A.K.notFound.activeUsers} users [M]`, impactLow: 0, impact: 0, impactHigh: 0, confidence: 'med', effort: 'S', horizon: 'quick win (<1 week)' });
  for (const p of pages.filter((x) => x.type === 'file')) act({ action: `Decide whether ${p.url} should appear in Google results; if not, serve it with "X-Robots-Tag: noindex" (public/_headers)`, analysis: 'K', target: p.url, evidence: `${p.impressions} impressions at position ${p.position} [M]`, impactLow: 0, impact: 0, impactHigh: 0, confidence: 'med', effort: 'S', horizon: 'quick win (<1 week)' });
  if (!queryPage) act({ action: 'Export query × page (GSC → Performance → Pages → click a page → Queries, or the API) and re-run with --query-page so cannibalization and striking distance are measured, not inferred', analysis: 'D, B', target: 'data', evidence: 'CSV export has no query×page pairing', impactLow: 0, impact: 0, impactHigh: 0, confidence: 'high', effort: 'S', horizon: 'quick win (<1 week)' });
  const cold = A.K.rows.filter((r) => r.built === 'yes' && r.inGsc === 'no' && /calculator|instance|guide|home/.test(r.type));
  if (cold.length) act({ action: `Check index status (URL Inspection) of the ${cold.length} home, calculator and answer pages with zero impressions: ${cold.slice(0, 6).map((r) => r.item).join(' ')}${cold.length > 6 ? ' …' : ''}; request indexing where Google has not crawled them`, analysis: 'K', target: `${cold.length} pages`, evidence: `${site.size} built, ${A.K.counts.builtWithImpressions} with impressions [M]`, impactLow: 0, impact: round(cold.length * (runRateMonthly / Math.max(1, site.size)) * expCtr(10, 'expected'), 1), impactHigh: round(cold.length * (runRateMonthly / Math.max(1, site.size)) * expCtr(10, 'optimistic'), 1), confidence: 'low', effort: 'S', horizon: 'quick win (<1 week)' });
  const backlog = [...registry.values()].filter((r) => r.status === 'launch' && site.size && !site.has(normUrl(r.url)));
  const perPage = runRateMonthly / Math.max(1, site.size); // [P] impressions per built page per 28 days (pages with none count too)
  if (backlog.length) act({ action: `Build the ${backlog.length} registry pages already approved (status "launch") but not built yet, a batch at a time through the normal gates; more indexed pages is the main source of new impressions`, analysis: 'E', target: `${backlog.filter((r) => r.type === 'calculator').length} calculators, ${backlog.filter((r) => r.type !== 'calculator').length} guides/instances`, evidence: `${[...registry.values()].filter((r) => r.status === 'launch').length} launch rows, ${site.size} built pages [M]; ${round(perPage, 0)} impressions per built page per 28 days [P]`, impactLow: round(backlog.length * perPage * expCtr(10, 'conservative'), 1), impact: round(backlog.length * perPage * expCtr(10, 'expected'), 1), impactHigh: round(backlog.length * perPage * expCtr(10, 'optimistic'), 1), confidence: 'low', effort: 'L', horizon: 'strategic (6+ weeks)' });
  A.E.backlog = backlog.map((r) => ({ item: r.url, type: r.type, primary: r.primary, volume: r.evidence?.primaryVolume ?? '', kd: r.evidence?.primaryKd ?? '' }));
}
const extraPath = path.join(OUT, 'actions.extra.json'); // optional, per run: [{action, analysis, target, evidence, impactLow, impact, impactHigh, confidence, effort, horizon}]
if (fs.existsSync(extraPath)) for (const a of JSON.parse(fs.readFileSync(extraPath, 'utf8'))) act(a);
for (const a of actions) a.rice = a.impact == null ? null : round((a.impact * conf[a.confidence]) / eff[a.effort], 2);
actions.sort((a, b) => (b.rice ?? -1) - (a.rice ?? -1) || eff[a.effort] - eff[b.effort]);

// ───────────────────────── outputs: workbook ─────────────────────────
function xlsx(file, sheets) {
  const crcT = (b) => zlib.crc32(b) >>> 0;
  const col = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const used = new Set();
  const names = sheets.map((s) => { let n = s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31); while (used.has(n)) n = n.slice(0, 29) + '_2'; used.add(n); return n; });
  const sheetXml = (s) => {
    const rows = s.rows; const widths = [];
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => { const ref = `${col(ci)}${ri + 1}`; const len = String(v ?? '').length; widths[ci] = Math.min(70, Math.max(widths[ci] || 8, len + 2)); const st = ri === (s.headerRow ?? 0) ? ' s="1"' : (s.noteRows || []).includes(ri) ? ' s="2"' : ''; if (v == null || v === '') return ''; return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`; }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${(s.headerRow ?? 0) + 1}" topLeftCell="A${(s.headerRow ?? 0) + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w || 10}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
  };
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF52514E"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>`,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
  const parts = [], central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8'), comp = zlib.deflateRawSync(data), nb = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(0x00210000, 10); h.writeUInt32LE(crcT(data), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(0x00210000, 12); c.writeUInt32LE(crcT(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nb, comp); central.push(c, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, end]));
}
const tableRows = (rows) => { if (!rows.length) return [['(no rows)']]; const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]; return [keys, ...rows.map((r) => keys.map((k) => (r[k] === null || r[k] === undefined ? '' : typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k])))]; };
const sheet = (name, method, rows) => ({ name, headerRow: 2, noteRows: [0], rows: [[method], [], ...tableRows(rows)] });
const sheets = [
  { name: 'Master actions', headerRow: 2, noteRows: [0], rows: [['RICE = impact (est. extra clicks per 28 days, expected scenario [P]) × confidence (high 1, med 0.5, low 0.25) ÷ effort (S 1, M 3, L 8). All gains are estimates on a 2-click sample.'], [], ...tableRows(actions.map((a, i) => ({ rank: i + 1, ...a })))] },
  { name: 'Baseline', headerRow: 0, rows: [['metric', 'value', 'label', 'source / note'], ...baseline, [], ['cluster', 'queries', 'impressions', 'clicks', 'ctr', 'position'], ...clusters.map((c) => Object.values(c))] },
  { name: 'Inventory', headerRow: 0, rows: [...tableRows(inventory), [], ['warnings'], ...warnings.map((w) => [w])] },
  { name: 'CTR curve', headerRow: 2, noteRows: [0], rows: [[`Own curve by position bucket. A bucket is trusted with ≥ ${CFG.ownCurve.minImpressions} impressions and ≥ ${CFG.ownCurve.minClicks} clicks; none is, so the benchmark [P][U] × realisation factor is used. 95% interval on ${totalClicks} clicks: ${ci(totalClicks).join('–')}.`], [], ...tableRows(curve.map((c) => ({ ...c, ownCtr: pct(c.ownCtr), benchmarkCtr: pct(c.benchmarkCtr) }))), [], ['scenario', 'share of benchmark', 'basis', 'striking distance (run-rate)', 'snippet gap', 'total extra clicks / 28 days', 'if the spike recurred'], ...Object.entries(upside).map(([k, v]) => [k, v.factor, scen[k].basis, v.strikingRunRate, v.snippet, v.total, v.ifSpikeRecurs])] },
  ...Object.entries(A).map(([, a]) => sheet(a.title, a.method, a.rows)),
  sheet('C by intent', 'Impressions and clicks by query intent (rule-based).', A.C.byIntent),
  sheet('E GA4-only queries', 'Queries in the GA4 all-country export that are not in the GSC US export (top 25).', A.E.gaOnly),
  sheet('E registry backlog', 'Registry rows with status "launch" that have no built page. Volume is a Keyword Planner/Semrush figure from the registry [R]/[P], not a forecast.', A.E.backlog || []),
  sheet('L hubs', 'Category hubs: do they link every calculator in the category?', A.L.hubs),
  sheet('Queries (clean)', 'All GSC queries with intent, bucket, mapped page (measured or inferred) and spike flag.', queries.map((q) => ({ query: q.query, impressions: q.impressions, clicks: q.clicks, ctr: round(q.ctr, 4), position: q.position, bucket: q.bucket, brand: q.brand ? 'yes' : '', intent: q.intent, page: q.page ?? '', pageSource: q.pageSource, otherPage: q.otherPage ?? '', cluster: q.cluster, spikeSuspect: q.spikeSuspect ? 'yes' : '' }))),
  sheet('Pages (joined)', 'Every URL seen in GSC, GA4 or the built site, joined.', joined.map((p) => ({ ...p, ctr: round(p.ctr, 4), engagementRate: round(p.engagementRate, 2), eventsPerUser: round(p.eventsPerUser, 1) }))),
  sheet('GA4 pages', 'GA4 page titles and the URL each was matched to.', ga4Pages),
];
xlsx(path.join(OUT, 'search-analysis.xlsx'), sheets);

// ───────────────────────── outputs: charts (SVG, light surface, one axis each) ─────────────────────────
const C = { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', s4: '#eda100' };
const FONT = 'font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"';
const svgWrap = (w, h, title, sub, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}"><rect width="${w}" height="${h}" fill="${C.surface}"/><text x="24" y="30" ${FONT} font-size="16" font-weight="600" fill="${C.ink}">${esc(title)}</text><text x="24" y="50" ${FONT} font-size="12" fill="${C.ink2}">${esc(sub)}</text>${body}</svg>`;
const txt = (x, y, s, o = {}) => `<text x="${round(x, 1)}" y="${round(y, 1)}" ${FONT} font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v); };
const charts = {};
// 1 trend: small multiples (impressions, clicks, position), never a dual axis
{
  const W = 860, H = 520, L = 64, R = 24, pw = W - L - R; const n = chart.length; const x = (i) => L + (n > 1 ? (i * pw) / (n - 1) : pw / 2);
  const panel = (top, ht, label, vals, color, o = {}) => {
    const mx = niceMax(Math.max(...vals.filter((v) => v != null), 1)); const y = (v) => (o.invert ? top + (v / mx) * ht : top + ht - (v / mx) * ht);
    let s = txt(L, top - 8, label, { fill: C.ink2, size: 12, weight: 600 });
    for (const t of [0, 0.5, 1]) { const yy = o.invert ? top + t * ht : top + ht - t * ht; s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${t === 0 && !o.invert ? C.axis : C.grid}" stroke-width="1"/>` + txt(L - 8, yy + 4, round(mx * t, 1).toLocaleString('en-US'), { anchor: 'end' }); }
    if (o.bars) { const bw = Math.max(4, pw / n - 6); s += vals.map((v, i) => (v ? `<rect x="${round(x(i) - bw / 2, 1)}" y="${round(y(v), 1)}" width="${round(bw, 1)}" height="${round(top + ht - y(v), 1)}" rx="2" fill="${color}"><title>${chart[i].date}: ${v}</title></rect>` : '')).join(''); }
    else { const pts = vals.map((v, i) => (v == null ? null : [x(i), y(v)])); let d = '', pen = false; for (const p of pts) { if (!p) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${round(p[0], 1)},${round(p[1], 1)}`; pen = true; } s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` + pts.map((p, i) => (p ? `<circle cx="${round(p[0], 1)}" cy="${round(p[1], 1)}" r="4" fill="${color}" stroke="${C.surface}" stroke-width="2"><title>${chart[i].date}: ${vals[i]}</title></circle>` : '')).join(''); }
    return s + (o.note ? o.note(x, y) : '');
  };
  const peak = chart.reduce((a, r, i) => (r.impressions > chart[a].impressions ? i : a), 0);
  let b = panel(92, 150, 'Impressions per day', chart.map((r) => r.impressions), C.s1, { note: (xx, yy) => txt(xx(peak) + 10, yy(chart[peak].impressions) + 12, `${chart[peak].impressions.toLocaleString('en-US')} on ${chart[peak].date.slice(5)}`, { fill: C.ink, weight: 600 }) });
  b += panel(290, 60, `Clicks per day (total ${totalClicks})`, chart.map((r) => r.clicks), C.s1, { bars: true });
  b += panel(400, 80, 'Average position (1 = top, axis inverted)', chart.map((r) => r.position), C.s1, { invert: true });
  b += chart.map((r, i) => (i % Math.ceil(n / 9) === 0 || i === n - 1 ? txt(x(i), 502, r.date.slice(5), { anchor: 'middle' }) : '')).join('');
  charts.trend = svgWrap(W, H, 'Search trend: one spike, then a low baseline', `GSC ${gscFilters.Country || ''} web, ${gscRange.start} to ${gscRange.end} [M]. ${pct(spikeImpr / totalImpr, 0)} of impressions fell on ${spikeDays.length} days.`, b);
}
// 2 CTR vs position (log x for impressions size → use dot area), with the benchmark and the scenario curves
{
  const W = 860, H = 500, L = 64, R = 150, T = 80, B = 50, pw = W - L - R, ph = H - T - B; const maxPos = 20; const maxY = 0.3;
  const x = (p) => L + ((Math.min(p, maxPos) - 1) / (maxPos - 1)) * pw, y = (c) => T + ph - (Math.min(c, maxY) / maxY) * ph;
  let b = ''; for (const t of [0, 0.1, 0.2, 0.3]) b += `<line x1="${L}" x2="${L + pw}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? C.grid : C.axis}"/>` + txt(L - 8, y(t) + 4, `${t * 100}%`, { anchor: 'end' });
  for (const p of [1, 3, 5, 8, 10, 15, 20]) b += txt(x(p), T + ph + 18, p === 20 ? '20+' : p, { anchor: 'middle' });
  b += txt(L + pw / 2, H - 10, 'Average position', { anchor: 'middle', fill: C.ink2 }) + txt(L, T - 10, 'CTR', { fill: C.ink2 });
  const line = (f, color, dash) => `<path d="${Array.from({ length: 39 }, (_, i) => 1 + i * 0.5).map((p, i) => `${i ? 'L' : 'M'}${round(x(p), 1)},${round(y(f(p)), 1)}`).join('')}" fill="none" stroke="${color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  b += line(bench, C.muted, '5 4') + line((p) => bench(p) * scen.optimistic.factor, C.s2) + line((p) => bench(p) * scen.expected.factor, C.s3);
  b += txt(x(1) + 8, y(bench(1)) + 4, 'benchmark [P][U]', { fill: C.ink2 }) + txt(x(1) + 8, y(bench(1) * scen.optimistic.factor) - 6, 'optimistic (50% of benchmark)', { fill: C.ink2 }) + txt(x(1) + 8, y(bench(1) * scen.expected.factor) - 8, `expected (${pct(scen.expected.factor, 0)} of benchmark)`, { fill: C.ink2 });
  const maxI = Math.max(...queries.map((q) => q.impressions), 1);
  const dots = [...queries].sort((a, b2) => b2.impressions - a.impressions);
  b += dots.map((q) => `<circle cx="${round(x(q.position), 1)}" cy="${round(y(q.ctr ?? 0), 1)}" r="${round(4 + 22 * Math.sqrt(q.impressions / maxI), 1)}" fill="${C.s1}" fill-opacity="${q.clicks ? 0.9 : 0.35}" stroke="${C.surface}" stroke-width="1.5"><title>${esc(q.query)}: ${q.impressions} impressions, ${q.clicks} clicks, position ${q.position}</title></circle>`).join('');
  for (const q of dots.filter((d, i) => d.clicks > 0 || i === 0).slice(0, 3)) { const rr = 4 + 22 * Math.sqrt(q.impressions / maxI); const over = (q.ctr ?? 0) > maxY; b += txt(x(q.position) + (over ? 10 : 0), over ? y(maxY) + 4 : y(q.ctr ?? 0) - rr - 22, `"${q.query}"`, { fill: C.ink, weight: 600, anchor: over ? 'start' : 'middle' }) + txt(x(q.position) + (over ? 10 : 0), over ? y(maxY) + 18 : y(q.ctr ?? 0) - rr - 8, `${q.impressions.toLocaleString('en-US')} impressions · ${q.clicks} click${q.clicks === 1 ? '' : 's'}${over ? ` · CTR ${pct(q.ctr, 0)} (off the scale)` : ''}`, { fill: C.ink2, anchor: over ? 'start' : 'middle' }); }
  b += `<circle cx="${L + pw + 24}" cy="${T + 10}" r="6" fill="${C.s1}" fill-opacity="0.9"/>` + txt(L + pw + 36, T + 14, 'query with a click', { fill: C.ink2 }) + `<circle cx="${L + pw + 24}" cy="${T + 32}" r="6" fill="${C.s1}" fill-opacity="0.35"/>` + txt(L + pw + 36, T + 36, 'query, no clicks', { fill: C.ink2 }) + txt(L + pw + 18, T + 58, 'dot area = impressions', { fill: C.ink2 });
  charts.ctr = svgWrap(W, H, `CTR vs position: ${queries.filter((q) => !q.clicks).length} of ${queries.length} queries have no clicks`, `Each dot is a GSC query [M]. Own curve has no support (${totalClicks} clicks), so lines are a benchmark and two scaled scenarios [P]. CTR axis capped at 30%.`, b);
}
// 3 opportunity bubble: pages, x = position, y = impressions (log), size = expected gain at position 4
{
  const W = 860, H = 500, L = 64, R = 40, T = 80, B = 50, pw = W - L - R, ph = H - T - B; const ps = pages.filter((p) => p.impressions > 0 && p.position <= 30);
  const maxL = Math.ceil(Math.log10(Math.max(...ps.map((p) => p.impressions), 10)));
  const x = (p) => L + ((p - 1) / 29) * pw, y = (v) => T + ph - (Math.log10(Math.max(v, 1)) / maxL) * ph;
  let b = `<rect x="${x(CFG.striking.minPos)}" y="${T}" width="${x(CFG.striking.maxPos) - x(CFG.striking.minPos)}" height="${ph}" fill="${C.grid}" fill-opacity="0.45"/>` + txt((x(8) + x(20)) / 2, T + 14, 'striking distance (8–20)', { anchor: 'middle', fill: C.ink2 });
  for (let i = 0; i <= maxL; i++) b += `<line x1="${L}" x2="${L + pw}" y1="${y(10 ** i)}" y2="${y(10 ** i)}" stroke="${i ? C.grid : C.axis}"/>` + txt(L - 8, y(10 ** i) + 4, (10 ** i).toLocaleString('en-US'), { anchor: 'end' });
  for (const p of [1, 5, 10, 15, 20, 25, 30]) b += txt(x(p), T + ph + 18, p, { anchor: 'middle' });
  b += txt(L + pw / 2, H - 10, 'Average position', { anchor: 'middle', fill: C.ink2 }) + txt(L, T - 10, 'Impressions (log scale)', { fill: C.ink2 });
  const g = (p) => Math.max(0, p.impressions * expCtr(CFG.striking.targetPos, 'expected') - p.clicks); const mg = Math.max(...ps.map(g), 1);
  const sorted = [...ps].sort((a, b2) => g(b2) - g(a));
  b += sorted.map((p) => `<circle cx="${round(x(p.position), 1)}" cy="${round(y(p.impressions), 1)}" r="${round(5 + 30 * Math.sqrt(g(p) / mg), 1)}" fill="${C.s1}" fill-opacity="0.55" stroke="${C.surface}" stroke-width="2"><title>${p.url}: ${p.impressions} impressions, position ${p.position}, est. +${round(g(p), 1)} clicks at position 4 [P]</title></circle>`).join('');
  sorted.slice(0, 4).forEach((p, i) => { const rr = 5 + 30 * Math.sqrt(g(p) / mg); const left = i % 2 === 1; b += txt(x(p.position) + (left ? -rr - 8 : rr + 8), y(p.impressions) + 4, `${p.url.split('/').filter(Boolean).slice(-1)[0]} (+${round(g(p), 1)})`, { fill: C.ink, anchor: left ? 'end' : 'start' }); });
  charts.bubble = svgWrap(W, H, 'Opportunity by page: one page holds almost all of it, and it was a spike', `GSC pages [M]. Bubble area = est. extra clicks per 28 days at position ${CFG.striking.targetPos}, expected scenario [P], at the volume seen this month.`, b);
}
// 4 device + country
{
  const W = 860, H = 380, L = 110, T = 96; const bw = 200; const mx = Math.max(...gscDevices.map((d) => d.impressions), 1);
  const order = ['Desktop', 'Mobile', 'Tablet']; const devs = [...gscDevices].sort((a, b2) => order.indexOf(a.key) - order.indexOf(b2.key));
  let b = txt(24, T - 14, 'Impressions by device', { fill: C.ink2, size: 12, weight: 600 }) + txt(560, T - 14, 'GA4 active users by city', { fill: C.ink2, size: 12, weight: 600 });
  devs.forEach((d, i) => { const yy = T + i * 44; b += txt(L - 10, yy + 17, d.key, { anchor: 'end', fill: C.ink2, size: 12 }) + `<rect x="${L}" y="${yy}" width="${round((d.impressions / mx) * bw, 1)}" height="26" rx="4" fill="${C.s1}"><title>${d.key}: ${d.impressions} impressions, ${d.clicks} clicks, position ${d.position}</title></rect>` + txt(L + (d.impressions / mx) * bw + 8, yy + 17, `${d.impressions.toLocaleString('en-US')} · ${d.clicks} click${d.clicks === 1 ? '' : 's'} · position ${d.position}`, { fill: C.ink, size: 12 }); });
  b += txt(24, T + 160, `Country (GSC): ${gscCountries.map((c) => `${c.key} ${c.impressions.toLocaleString('en-US')} impressions`).join(', ') || 'n/a'}.`, { fill: C.ink2, size: 12 }) + txt(24, T + 180, `The export is filtered to ${gscFilters.Country || 'no country'}, so other countries are not shown, not zero.`, { fill: C.ink2, size: 12 });
  const cities = [...ga4.cities].sort((a, b2) => b2.activeUsers - a.activeUsers); const topC = cities.slice(0, 5); const rest = sum(cities.slice(5), (c) => c.activeUsers); if (rest) topC.push({ key: `${cities.length - 5} other cities`, activeUsers: rest });
  const cm = Math.max(...topC.map((c) => c.activeUsers), 1);
  topC.forEach((c, i) => { const yy = T + i * 36; b += txt(668, yy + 15, c.key, { anchor: 'end', fill: C.ink2, size: 12 }) + `<rect x="678" y="${yy}" width="${round((c.activeUsers / cm) * 130, 1)}" height="22" rx="4" fill="${C.s1}"><title>${c.key}: ${c.activeUsers} active users</title></rect>` + txt(686 + (c.activeUsers / cm) * 130, yy + 15, c.activeUsers, { fill: C.ink, size: 12 }); });
  b += txt(560, T + topC.length * 36 + 16, `All traffic [M], ${gaUsers} users in total.`, { fill: C.ink2, size: 12 });
  charts.device = svgWrap(W, H, 'Device and geography: desktop sees more, nobody clicks much', `GSC devices and country [M] ${gscRange.start} to ${gscRange.end}; GA4 cities [M] ${ga4.range.start} to ${ga4.range.end}.`, b);
}
const chartFiles = { trend: '1-trend.svg', ctr: '2-ctr-vs-position.svg', bubble: '3-opportunity-bubble.svg', device: '4-device-country.svg' };
for (const [k, f] of Object.entries(chartFiles)) fs.writeFileSync(path.join(OUT, 'charts', f), charts[k]);

// ───────────────────────── outputs: report (HTML, one short section per gap) ─────────────────────────
const LEAN = ['item', 'page', 'impressions', 'clicks', 'ctr', 'position', 'gap', 'gainExp', 'clicksAtPos4_exp', 'intent', 'primary', 'second', 'source', 'flag', 'ga4Views', 'engagementRate', 'from', 'anchor', 'breadcrumb', 'faqPage', 'appSchema', 'shareOfImpressions', 'queries', 'spike'];
const htmlTable = (rows, n = 10) => { if (!rows.length) return '<p class="none">No rows meet the threshold.</p>'; const keys = LEAN.filter((k) => rows.some((r) => r[k] !== undefined && r[k] !== '')); return `<div class="tw"><table><thead><tr>${keys.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, n).map((r) => `<tr>${keys.map((k) => `<td>${esc(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length > n ? `<p class="more">${rows.length - n} more rows in the workbook.</p>` : ''}`; };
const topQ = [...queries].sort((a, b) => b.impressions - a.impressions)[0];
const soWhat = {
  A: () => A.A.rows.length ? `${A.A.rows.length} item(s) pass the threshold, led by "${A.A.rows[0].item}" (${A.A.rows[0].impressions} impressions, ${A.A.rows[0].clicks} clicks) [M]. With ${totalClicks} clicks in the whole sample, the "expected" CTR is a scaled benchmark [P], so this flags where to look, not a measured loss. For a sum like this one, Google usually shows the answer on the results page, so a low CTR at position 9 is the normal outcome, not a title problem.` : 'Nothing passes the threshold.',
  B: () => `${A.B.total} non-branded queries sit at positions 8–20 [M]; ${A.B.rows.filter((r) => r.spike).length} of them is the spike query. At run-rate volume the whole group is worth about ${upside.conservative.strikingRunRate}–${upside.optimistic.strikingRunRate} extra clicks per 28 days (expected ${upside.expected.strikingRunRate}) [P] if every page reached position ${CFG.striking.targetPos}.`,
  C: () => `${A.C.rows.length} queries have ≥ ${CFG.zeroClick.minImpressions} impressions and ≤ 1 click [M]. By intent: ${A.C.byIntent.map((i) => `${i.intent} ${i.impressions} impressions / ${i.clicks} clicks`).join('; ')} [M]. Direct-answer sums are the bulk of impressions and the weakest source of clicks; tool queries are fewer but are the ones a calculator page can win.`,
  D: () => A.D.measured ? `${A.D.rows.length} queries show two or more URLs [M].` : `Not measurable from these files. ${A.D.rows.length} candidate overlaps by wording [P]; treat them as questions to check, not findings.`,
  E: () => `${A.E.rows.length} queries with impressions match no built page well [P]. ${A.E.gaOnly.length ? `The GA4 all-country export adds ${ga4Queries.length - gscQueries.filter((q) => ga4Queries.some((g) => g.key === q.key)).length} queries the US export lacks; many are exact-match quoted queries, which look like rank-checker traffic.` : ''} The registry has ${(A.E.backlog || []).length} approved rows not built yet and ${A.E.queued} queued rows [M]; new pages go through the registry, never straight from this list.`,
  F: () => { const f = A.F.rows.filter((r) => r.flag); return `${f.length} page(s) flagged [P]: ${f.slice(0, 4).map((r) => `${r.item} (${r.flag})`).join('; ') || 'none'}. GA4 has ${gaUsers} users in the period, so every engagement figure here rests on a handful of visits, some of them probably the owner's.`; },
  G: () => `${pct(spikeImpr / totalImpr, 0)} of impressions came on ${A.G.stats.spikeDays.length} days (${A.G.stats.spikeDays[0]?.slice(5)} to ${A.G.stats.spikeDays.at(-1)?.slice(5)}) [M]. Since then the median day has ${A.G.stats.afterSpikeMedian} impressions at position ${A.G.stats.afterSpikePos} (spike days: ${A.G.stats.spikePos}) [M]. Last days: ${A.G.stats.lastDays.join(', ')} [M] (the newest days in any export are incomplete). The drop is demand going away, not a ranking loss: position on the spike query was stable. No seasonality can be read from ${chart.length} days.`,
  H: () => `${A.H.rows.map((r) => `${r.item}: ${r.impressions} impressions, ${r.clicks} clicks, position ${r.position}`).join('; ')} [M]. With ${totalClicks} clicks no device difference in CTR is real; the position gap (desktop about 1.5 lower) is the only thing worth a look, on the fraction answer pages.`,
  I: () => `Only ${gscFilters.Country || 'one country'} is in the GSC export. The GA4 all-country query export shows ${sum(ga4Queries, (r) => r.impressions)} impressions against ${sum(queries, (r) => r.impressions)} for US-visible queries [M], so non-US demand is small [P]. The site is one language; hreflang has nothing to point at and is not recommended.`,
  J: () => { const noB = A.J.rows.filter((r) => r.breadcrumb === 'MISSING').length, noApp = A.J.rows.filter((r) => r.type === 'calculator' && r.appSchema === 'no').length; return `${site.size} built pages: ${noB} lack BreadcrumbList, ${A.J.rows.filter((r) => r.faqPage === 'yes').length} carry FAQPage, ${noApp} of ${A.J.rows.filter((r) => r.type === 'calculator').length} calculators have no WebApplication/SoftwareApplication type [M]. Search appearance rows: ${gscAppearance.map((a) => `${a.key} ${a.impressions} impressions at position ${a.position}`).join('; ') || 'none'} [M].`; },
  K: () => `${A.K.counts.built} built pages, ${A.K.counts.builtWithImpressions} with impressions, ${A.K.counts.builtNoImpr} with none [M]; among them the home page and ${A.K.counts.calculatorsNoImpr.length} calculators (${A.K.counts.calculatorsNoImpr.map((u) => u.split('/').filter(Boolean).pop()).join(', ')}). Zero impressions in a US-only export does not prove a page is not indexed; URL Inspection does. ${pages.filter((p) => p.type === 'file').map((p) => `${p.url} is showing in results (${p.impressions} impressions) [M].`).join(' ')} ${A.K.notFound ? `GA4 logged ${A.K.notFound.views} views of the 404 page by ${A.K.notFound.activeUsers} users [M].` : ''}`,
  L: () => `${A.L.rows.length} link suggestions for ${new Set(A.L.rows.map((r) => r.item)).size} striking-distance pages; ${A.L.hubs.filter((h) => h.missing !== 'none').length} hubs miss a calculator link; ${A.L.orphans.length} built pages have ≤ 1 inlink [M].`,
  M: () => 'No data in these exports. Run the performance-auditor agent on the production build; with clicks this low, speed is not what limits traffic.',
  N: () => 'Not run. See the limits section for what it needs.',
  O: () => `Branded: ${sum(brandRows, (r) => r.clicks)} clicks, ${sum(brandRows, (r) => r.impressions)} impressions [M]. All search traffic is non-branded; there is no brand demand to depend on yet.`,
};
const css = `:root{--bg:#f9f9f7;--card:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--line:#e1e0d9}@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d0d0d;--card:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--line:#2c2c2a}}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}main{max-width:920px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:8px 0}h2{font-size:18px;margin:36px 0 6px}p{margin:8px 0}.meta,.more,.none,.method{color:var(--ink2);font-size:13px}.tw{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--ink2);font-weight:600;white-space:nowrap}td{font-variant-numeric:tabular-nums}figure{margin:16px 0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fcfcfb}figure svg{display:block;width:100%;height:auto}.so{border-left:3px solid #2a78d6;padding-left:12px}`;
const report = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Search analysis ${gscRange.end}</title><style>${css}</style></head><body><main>
<p class="meta">${DOMAIN} · GSC ${gscRange.start} → ${gscRange.end} (${gscFilters.Country || 'all countries'}) · GA4 ${ga4.range.start} → ${ga4.range.end} · generated ${new Date().toLocaleDateString('en-CA')} · [M] measured, [P] estimate, [U] unverified</p>
<h1>Search Console + GA4 analysis</h1>
<p class="so">${totalImpr.toLocaleString('en-US')} impressions and ${totalClicks} clicks [M]. ${pct(topQ.impressions / totalImpr, 0)} of impressions are one query, "${esc(topQ.query)}", and ${pct(spikeImpr / totalImpr, 0)} fell on ${spikeDays.length} days. Without the spike the site earns about ${runRateMonthly} impressions per 28 days [P]. Estimated extra clicks per 28 days if every position-8–20 query reached position ${CFG.striking.targetPos}: ${upside.conservative.total} conservative, ${upside.expected.total} expected, ${upside.optimistic.total} optimistic [P].</p>
<h2>Baseline</h2><div class="tw"><table><thead><tr><th>metric</th><th>value</th><th>label</th><th>note</th></tr></thead><tbody>${baseline.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<figure>${charts.trend}</figure>
<h2>Top clusters</h2>${htmlTable(clusters.map((c) => ({ item: c.cluster, queries: c.queries, impressions: c.impressions, clicks: c.clicks, ctr: c.ctr, position: c.position })), 8)}
<h2>CTR curve</h2><p class="method">No position bucket has enough clicks to trust (needs ≥ ${CFG.ownCurve.minImpressions} impressions and ≥ ${CFG.ownCurve.minClicks} clicks). The benchmark is Backlinko 2023 quoted from memory [P][U]. The site's realised share of that benchmark is ${pct(scen.conservative.factor, 1)} (all queries) to ${pct(scen.expected.factor, 1)} (without the spike query); with ${totalClicks} clicks the 95% interval on the count is ${ci(totalClicks).join('–')}, so these shares could be several times higher or lower.</p>
<figure>${charts.ctr}</figure><figure>${charts.bubble}</figure>
${Object.entries(A).map(([k, a]) => `<h2>${esc(a.title)}</h2><p class="method">${esc(a.method)}</p>${k === 'G' ? '' : htmlTable(k === 'J' ? a.rows.filter((r) => r.impressions > 0 || r.breadcrumb === 'MISSING') : k === 'K' ? a.rows.filter((r) => r.flag) : a.rows, k === 'K' ? 12 : 10)}<p class="so"><strong>So what:</strong> ${esc(soWhat[k]())}</p>${k === 'I' ? `<figure>${charts.device}</figure>` : ''}`).join('\n')}
<h2>Actions (RICE)</h2>${htmlTable(actions.map((a) => ({ item: a.action, page: a.target, gainExp: a.impact ?? 'n/e', source: `${a.confidence} / ${a.effort}`, flag: a.horizon })), 25)}
<h2>Inputs and warnings</h2>${htmlTable(inventory.map((i) => ({ item: i.file, queries: i.rows, source: i.dateRange, flag: i.issues })), 20)}${warnings.map((w) => `<p class="meta">Warning: ${esc(w)}</p>`).join('')}
</main></body></html>`;
fs.writeFileSync(path.join(OUT, 'report.html'), report);
fs.writeFileSync(path.join(OUT, 'analysis.json'), JSON.stringify({ generated: new Date().toISOString(), config: CFG, inventory, warnings, overlap, baseline, clusters, curve, scenarios: scen, upside, hidden, runRateMonthly, analyses: A, actions }, null, 1));

// ───────────────────────── console summary (aggregates only) ─────────────────────────
const check = (name, a, b) => console.log(`  ${a === b ? 'OK  ' : 'DIFF'} ${name}: ${a} vs ${b}`);
console.log(`\nSearch analyzer → ${path.relative(process.cwd(), OUT)}`);
console.log(`Inputs: ${inventory.map((i) => `${i.file.split('/').pop()} ${i.rows}`).join(' | ')}`);
console.log(`Totals [M]: ${totalImpr} impressions, ${totalClicks} clicks, CTR ${pct(totalClicks / totalImpr)}, position ${round(totalPos)}; ${overlap.note}`);
console.log('Cross-checks:');
check('impressions Countries vs Chart', sum(gscCountries, (r) => r.impressions), sum(chart, (r) => r.impressions));
check('clicks Countries vs Chart', sum(gscCountries, (r) => r.clicks), sum(chart, (r) => r.clicks));
check('impressions Countries vs Devices', sum(gscCountries, (r) => r.impressions), sum(gscDevices, (r) => r.impressions));
check('clicks Countries vs Devices', sum(gscCountries, (r) => r.clicks), sum(gscDevices, (r) => r.clicks));
console.log(`  Queries.csv sums to ${sum(queries, (r) => r.impressions)} impressions / ${sum(queries, (r) => r.clicks)} clicks → hidden ${hidden.impressions} / ${hidden.clicks}`);
console.log(`  Pages.csv sums to ${sum(pages, (r) => r.impressions)} impressions / ${sum(pages, (r) => r.clicks)} clicks (by-page counting differs from the by-property total, so this need not match)`);
console.log(`Spike: ${spikeDays.length} days hold ${pct(spikeImpr / totalImpr, 1)} of impressions; run-rate ≈ ${runRateMonthly} per 28 days [P]`);
console.log(`Realisation vs benchmark: ${pct(rfAll, 1)} all, ${pct(rfNoSpike, 1)} without spike query`);
console.log(`Upside per 28 days [P]: conservative ${upside.conservative.total}, expected ${upside.expected.total}, optimistic ${upside.optimistic.total} (if the spike recurred: ${upside.conservative.ifSpikeRecurs} / ${upside.expected.ifSpikeRecurs} / ${upside.optimistic.ifSpikeRecurs})`);
console.log(`Rows: ${Object.entries(A).map(([k, a]) => `${k}=${a.rows.length}`).join(' ')}; actions ${actions.length}; GA4 titles matched ${ga4Pages.filter((p) => p.url).length}/${ga4Pages.length}`);
if (warnings.length) console.log(`Warnings:\n  - ${warnings.join('\n  - ')}`);
console.log(`Files: search-analysis.xlsx, report.html, analysis.json, charts/{${Object.values(chartFiles).join(', ')}}, work/clean.json`);
