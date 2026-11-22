#!/usr/bin/env node
// Independent check of a run: recomputes headline numbers straight from the copied input CSVs
// (own parser, none of analyze.mjs's code) and compares them with analysis.json and the workbook.
// Usage: node scripts/search-analyzer/verify.mjs reports/search-analyzer/runs/<name>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const run = path.resolve(process.argv[2] || '.');
const inp = path.join(run, 'work', 'input');
const lines = (f) => fs.readFileSync(path.join(inp, f), 'utf8').replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean);
const split = (l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')).slice(0, -1);
const table = (f) => lines(f).slice(1).map(split);
const n = (v) => Number(String(v).replace('%', ''));
const tot = (rows, i) => rows.reduce((s, r) => s + n(r[i]), 0);
const A = JSON.parse(fs.readFileSync(path.join(run, 'analysis.json'), 'utf8'));
const clean = JSON.parse(fs.readFileSync(path.join(run, 'work', 'clean.json'), 'utf8'));
let fail = 0;
const eq = (name, a, b) => { const ok = Math.abs(a - b) < 0.006; if (!ok) fail++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: raw ${a} | analyzer ${b}`); };
const base = (m) => A.baseline.find((r) => r[0] === m)[1];

const countries = table('Countries.csv'), chart = table('Chart.csv'), devices = table('Devices.csv'), queries = table('Queries.csv'), pages = table('Pages.csv');
eq('impressions (Countries)', tot(countries, 2), base('GSC impressions'));
eq('clicks (Countries)', tot(countries, 1), base('GSC clicks'));
eq('impressions (Chart)', tot(chart, 2), base('GSC impressions'));
eq('impressions (Devices)', tot(devices, 2), base('GSC impressions'));
eq('clicks (Devices)', tot(devices, 1), base('GSC clicks'));
const wpos = chart.filter((r) => r[4]).reduce((s, r) => s + n(r[4]) * n(r[2]), 0) / tot(chart, 2);
eq('impression-weighted position', Math.round(wpos * 100) / 100, base('GSC position (impression-weighted)'));
eq('query rows', queries.length, clean.queries.length);
eq('query impressions', tot(queries, 2), clean.queries.reduce((s, q) => s + q.impressions, 0));
eq('hidden impressions', tot(countries, 2) - tot(queries, 2), A.hidden.impressions);
eq('hidden clicks', tot(countries, 1) - tot(queries, 1), A.hidden.clicks);
eq('page rows', pages.length, clean.pages.length);
eq('page impressions', tot(pages, 2), clean.pages.reduce((s, p) => s + p.impressions, 0));
const topQ = [...queries].sort((a, b) => n(b[2]) - n(a[2]))[0];
eq(`top query impressions ("${topQ[0]}")`, n(topQ[2]), Math.max(...clean.queries.map((q) => q.impressions)));
const strike = queries.filter((r) => n(r[4]) >= 8 && n(r[4]) <= 20).length;
eq('queries at positions 8–20', strike, A.analyses.B.total);
const snap = fs.readdirSync(inp).find((f) => /snapshot/i.test(f));
if (snap) { const L = lines(snap); const i = L.findIndex((l) => l.startsWith('Active users,')); eq('GA4 active users', n(L[i + 1].split(',')[0]), clean.ga4.totals.activeUsers); const s = L.findIndex((l) => l.startsWith('Session source')); let ses = 0; for (let k = s + 1; L[k] && !L[k].startsWith('#'); k++) ses += n(L[k].split(',').pop()); eq('GA4 sessions', ses, clean.ga4.sessionSource.reduce((a, r) => a + r.sessions, 0)); }

// spot-check 10 query rows, evenly spaced
const step = Math.max(1, Math.floor(queries.length / 10)); let bad = 0, seen = 0;
for (let i = 0; i < queries.length && seen < 10; i += step, seen++) { const r = queries[i]; const q = clean.queries.find((x) => x.query === r[0]); if (!q || q.impressions !== n(r[2]) || q.clicks !== n(r[1]) || q.position !== n(r[4]) || Math.abs((q.ctr ?? 0) - n(r[3]) / 100) > 1e-9) { bad++; console.log('  row differs:', r[0]); } }
if (bad) fail++; console.log(`${bad ? 'FAIL' : 'OK  '} spot-check: ${seen - bad}/${seen} query rows identical to the CSV`);

// workbook: valid zip, every sheet parses, master action rows = actions
const buf = fs.readFileSync(path.join(run, 'search-analysis.xlsx')); const files = {};
let p = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); const cnt = buf.readUInt16LE(p + 10); let off = buf.readUInt32LE(p + 16);
for (let i = 0; i < cnt; i++) { const nl = buf.readUInt16LE(off + 28), cs = buf.readUInt32LE(off + 20), lo = buf.readUInt32LE(off + 42), crc = buf.readUInt32LE(off + 16); const name = buf.slice(off + 46, off + 46 + nl).toString(); const lnl = buf.readUInt16LE(lo + 26), lel = buf.readUInt16LE(lo + 28); const data = zlib.inflateRawSync(buf.slice(lo + 30 + lnl + lel, lo + 30 + lnl + lel + cs)); if ((zlib.crc32(data) >>> 0) !== crc) { fail++; console.log('FAIL crc', name); } files[name] = data.toString(); off += 46 + nl; }
const sheets = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
const rowsIn = (i) => (files[`xl/worksheets/sheet${i + 1}.xml`].match(/<row /g) || []).length;
console.log(`OK   workbook: ${cnt} parts, ${sheets.length} sheets: ${sheets.map((s, i) => `${s} (${rowsIn(i)})`).join(', ')}`);
eq('master action rows in workbook', rowsIn(0) - 3, A.actions.length);
for (const f of ['report.html', 'charts/1-trend.svg', 'charts/2-ctr-vs-position.svg', 'charts/3-opportunity-bubble.svg', 'charts/4-device-country.svg']) { const ok = fs.existsSync(path.join(run, f)) && fs.statSync(path.join(run, f)).size > 1000; if (!ok) fail++; console.log(`${ok ? 'OK  ' : 'FAIL'} exists: ${f}`); }
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll checks passed');
process.exit(fail ? 1 : 0);
