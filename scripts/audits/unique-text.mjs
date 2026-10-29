// Duplicate-text check across pages (`npm run audit:unique`): the share of each page's own text that appears on no
// other page, so near-duplicate or doorway pages (Google's scaled-content-abuse policy, AdSense's low-value content)
// never ship.
//
// Method: each page's <main> without its navigation, asides and forms (breadcrumbs, related links, notices and a tool's
// inputs repeat by design), cut into 5-word shingles; a page fails under THRESHOLD % unique.
//
//   node scripts/audits/unique-text.mjs           content pages (two or more URL segments) in build.outputDir
//   node scripts/audits/unique-text.mjs --all     every page
import { builtPages, decode, isMain, mainOf, outputDir, readConfig } from '../lib/site.mjs';

export const THRESHOLD = 30;

export function pageWords(html) {
  const main = mainOf(html) || html;
  return decode(main
    .replace(/<(script|style|svg|nav|aside|form|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .toLowerCase().replace(/[^a-z0-9%./]+/g, ' ').split(' ').filter(Boolean);
}

export function shingles(words, n = 5) {
  const s = new Set();
  for (let i = 0; i + n <= words.length; i++) s.add(words.slice(i, i + n).join(' '));
  return s;
}

/** [{ route, unique, words }] for pages given as { route, html }. */
export function uniqueness(pages) {
  const sets = pages.map((p) => ({ route: p.route, words: pageWords(p.html).length, set: shingles(pageWords(p.html)) }));
  const count = new Map();
  for (const { set } of sets) for (const s of set) count.set(s, (count.get(s) ?? 0) + 1);
  return sets.map(({ route, words, set }) => ({ route, words, unique: set.size ? (100 * [...set].filter((s) => count.get(s) === 1).length) / set.size : 0 }));
}

if (isMain(import.meta.url)) {
  const cfg = readConfig();
  const all = process.argv.includes('--all');
  const pages = builtPages(outputDir(cfg)).filter((p) => !p.notFound && (all || p.route.split('/').filter(Boolean).length >= 2));
  if (pages.length < 2) {
    console.log(`audit:unique: ${pages.length} page(s) to compare; nothing to check yet`);
  } else {
    const rows = uniqueness(pages);
    console.log(`audit:unique: ${rows.length} page(s), threshold ${THRESHOLD}% unique [M: 5-word shingles]`);
    for (const r of rows) console.log(`  ${r.unique < THRESHOLD ? 'THIN' : 'ok  '} ${r.unique.toFixed(1).padStart(5)}% unique  ${String(r.words).padStart(5)} words  ${r.route}`);
    const thin = rows.filter((r) => r.unique < THRESHOLD);
    console.log(thin.length ? `audit:unique: FAIL, ${thin.length} page(s) under ${THRESHOLD}% unique` : 'audit:unique: OK');
    process.exitCode = thin.length ? 1 : 0;
  }
}
