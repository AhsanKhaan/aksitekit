// On-page SEO checks over the static build output (factory.config.json → build.outputDir), on every page: the 171
// checks of a SEOmator site audit, in its 16 categories, plus build budgets. A check that fails stops the build (and so
// the deploy); a warning is printed. Reviewed exceptions, each with a reason, live in seo-checks.json; nothing else may
// silence a check. Ported from calculatorporch.com, where it was built and calibrated on 2026-10-25 (docs/SEO-GATE.md).
//
//   node scripts/audits/seo-checks.mjs                   static checks over out/ (`npm run build` runs it)
//   node scripts/audits/seo-checks.mjs --strict          warnings fail too
//   node scripts/audits/seo-checks.mjs --json            machine-readable report
//   node scripts/audits/seo-checks.mjs --live <url> [paths...]   the checks only a live response can answer
//                                                        (compression, HTTP/3, caching, timing, headers, redirects)
//
// Keyword stuffing follows SEOmator's own method (its keyword density checker): whole-page text, words of 3+ letters,
// numbers and common stopwords dropped, density = occurrences / meaningful words. It judges the page's target terms
// (title, H1, keyword-map primary): stuffing is about keywords, so a month name in a date table isn't stuffing.
// Blank settings in seo-checks.json come from factory.config.json: outDir ← build.outputDir, siteUrl ← https://
// project.domain, siteName ← project.brand (or project.name). The env names are lists, so the technology-neutral
// SITE_URL / SITE_INDEXABLE and the Next.js NEXT_PUBLIC_* names both work (.github/README.md).
// SEO_CHECKS_CONFIG=<path>, SEO_CHECKS_FACTORY=<path> and SEO_CHECKS_OUT=<dir> point elsewhere (tests).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const config = JSON.parse(readFileSync(process.env.SEO_CHECKS_CONFIG || 'seo-checks.json', 'utf8'));
const factoryFile = process.env.SEO_CHECKS_FACTORY || 'factory.config.json';
const factory = existsSync(factoryFile) ? JSON.parse(readFileSync(factoryFile, 'utf8')) : {};
config.outDir ||= factory.build?.outputDir || 'out';
config.siteUrl ||= factory.project?.domain ? `https://${factory.project.domain}` : '';
config.siteName ||= factory.project?.brand || factory.project?.name || '';
const T = config.thresholds;
const OUT = process.env.SEO_CHECKS_OUT || config.outDir;
const envOf = (names) => [names].flat().map((n) => process.env[n]).find(Boolean);
const siteUrl = (envOf(config.siteUrlEnv) || config.siteUrl).replace(/\/+$/, '');
const production = envOf(config.indexableEnv) === 'true';
if (!siteUrl && !flag('--live')) {
  console.error('seo-checks: no site URL. Set project.domain in factory.config.json (or siteUrl in seo-checks.json).');
  process.exit(1);
}

// ---------- small HTML helpers (the export is generated, well-formed markup) ----------
const decode = (s) => s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
const BLOCK = /<\/(?:p|li|h[1-6]|td|th|tr|div|section|article|header|footer|nav|main|aside|figcaption|caption|dd|dt|blockquote|pre|summary|label|button|option)>|<br\s*\/?>/gi;
const textOf = (html, { blocks = false } = {}) => {
  let h = html.replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  if (blocks) h = h.replace(BLOCK, ' . ');
  return decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
};
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].slice(1).map((m) => [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? '')]));
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => ({ tag: m[0], index: m.index, a: attrs(m[0]) }));
const elements = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map((m) => ({ a: attrs(`<${name} ${m[1]}>`), inner: m[2], index: m.index }));
const words = (t) => t.toLowerCase().match(/[a-z][a-z'’-]*/g) || [];
// SEOmator's density checker drops words under 3 letters, numbers and common stopwords before counting.
const STOP = new Set(('the and for are but not you all any can had her was one our out has have this that with your from they will what when ' +
  'which their there about would make like into than then them these some more also just only been were its how').split(' '));
const meaningful = (t) => words(t).filter((w) => w.length >= 3 && !STOP.has(w));
const stem = (w) => w.replace(/(?<=[a-z]{3})(?:es|s)$/, '');
const syllables = (w) => { w = w.replace(/[^a-z]/g, ''); if (w.length <= 3) return 1; w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, ''); return (w.match(/[aeiouy]{1,2}/g) || []).length || 1; };
// Arial advance widths (1/1000 em), the font Google's results use. At 14.1 px this reproduces SEOmator's figures on
// calculatorporch.com (title ~331.5 px, description ~920.5 px, 2026-10-25 report). Digits are all 556.
const ARIAL = ' 278!278"355#556$556%889&667\'191(333)333*389+584,278-333.278/278:278;278<584=584>584?556@1015A667B667C722D722E667F611G778H722I278J500K667L556M833N722O778P667Q778R722S667T611U722V667W944X667Y667Z611[278\\278]278^469_556`333a556b556c500d556e556f278g556h556i222j222k500l222m833n556o556p556q556r333s500t278u556v500w722x500y500z500{334|260}334~584';
const AW = { ...Object.fromEntries([...ARIAL.matchAll(/(\D)(\d+)/g)].map((m) => [m[1], Number(m[2])])), ...Object.fromEntries([...'0123456789'].map((d) => [d, 556])) };
const pixelWidth = (s, px = 14.1) => [...s].reduce((w, ch) => w + (AW[ch] ?? 556), 0) * px / 1000;
const isExternal = (href) => /^https?:\/\//i.test(href) && !href.startsWith(siteUrl + '/') && href !== siteUrl;
const pathOf = (href) => (href.startsWith(siteUrl) ? href.slice(siteUrl.length) || '/' : href).split('#')[0].split('?')[0];

// ---------- load the export ----------
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
if (!flag('--live') && !existsSync(OUT)) { console.error(`seo-checks: ${OUT}/ not found. Build first.`); process.exit(1); }
const files = flag('--live') ? [] : walk(OUT);
const routeOf = (f) => { const r = '/' + relative(OUT, f).split(sep).join('/'); return r.endsWith('/index.html') ? r.slice(0, -10) : r; };
// research/out/keyword-map.json is { pages: [...] }; a bare array works too.
const keywordRows = config.keywordMap && existsSync(config.keywordMap) ? JSON.parse(readFileSync(config.keywordMap, 'utf8')) : [];
const keywordMap = new Map((Array.isArray(keywordRows) ? keywordRows : keywordRows.pages ?? []).map((r) => [r.url, r]));
const headersFile = [join(OUT, '_headers'), 'public/_headers'].find(existsSync);
const headersText = headersFile ? readFileSync(headersFile, 'utf8') : '';
const globalHeaders = (() => { const m = headersText.match(/^\/\*\s*\n((?:[ \t].+\n?)+)/m); return m ? Object.fromEntries(m[1].trim().split('\n').map((l) => l.trim().split(/:\s*/)).map(([k, ...v]) => [k.toLowerCase(), v.join(': ')])) : {}; })();
const robotsTxt = existsSync(join(OUT, 'robots.txt')) ? readFileSync(join(OUT, 'robots.txt'), 'utf8') : '';
const redirectsText = existsSync(join(OUT, '_redirects')) ? readFileSync(join(OUT, '_redirects'), 'utf8') : '';

function loadPage(file) {
  const html = readFileSync(file, 'utf8');
  const route = routeOf(file);
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : '';
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  const main = (body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [, body])[1];
  const meta = (key, val) => tags(head, 'meta').filter((t) => (t.a[key] || '').toLowerCase() === val.toLowerCase());
  const robots = meta('name', 'robots').map((t) => t.a.content.toLowerCase()).join(',');
  const jsonld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return { ok: true, data: JSON.parse(m[1]) }; } catch (e) { return { ok: false, error: e.message }; } });
  const links = elements(body, 'a').map((e) => ({ ...e, href: e.a.href ?? null, text: textOf(e.inner), alt: tags(e.inner, 'img').map((i) => i.a.alt || '').join(' ') }));
  return {
    file, route, html, head, body, main, robots, jsonld, links,
    title: elements(head, 'title').map((e) => textOf(e.inner)),
    desc: meta('name', 'description').map((t) => t.a.content || ''),
    canonical: tags(head, 'link').filter((t) => (t.a.rel || '').toLowerCase() === 'canonical').map((t) => t.a.href),
    og: (p) => (meta('property', p)[0]?.a.content ?? meta('name', p)[0]?.a.content ?? null),
    h1: elements(body, 'h1').map((e) => textOf(e.inner)),
    headings: [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: textOf(m[2]) })),
    images: tags(body, 'img'),
    scripts: [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ a: attrs(`<script ${m[1]}>`), content: m[2], inHead: m.index < headEnd })),
    styles: [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]),
    text: textOf(body),
    mainText: textOf(main),
    mainBlocks: textOf(main, { blocks: true }),
    lang: (html.match(/<html\s[^>]*?lang="([^"]*)"/i) || [, ''])[1],
    heldNoindex: /noindex/.test(robots) && !/nofollow/.test(robots),
    is404: /(?:^|\/)(?:404|_not-found)(?:\/|\.html|$)/.test(route),
  };
}
const pages = files.filter((f) => f.endsWith('.html')).map(loadPage);
const byRoute = new Map(pages.map((p) => [p.route, p]));
const ids = new Map(pages.map((p) => [p.route, new Set([...p.html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))]));
const existsPath = (p) => byRoute.has(p) || byRoute.has(p.endsWith('/') ? p : p + '/') || existsSync(join(OUT, p)) || existsSync(join(OUT, p, 'index.html'));

// ---------- the checks ----------
const CHECKS = [];
const check = (category, id, name, level, run, { scope = 'content' } = {}) => CHECKS.push({ category, id: `${category}.${id}`, name, level, run, scope });
// run(page) returns true (pass), a string (problem at the check's level), or { level, msg } to override the level.
const W = (msg) => ({ level: 'warn', msg });
const F = (msg) => ({ level: 'fail', msg });

const C = 'core';
check(C, 'title-present', 'Title Tag Present', 'fail', (p) => p.title.length > 0 && p.title[0].length > 0 || 'no <title>');
check(C, 'title-length', 'Title Tag Length', 'warn', (p) => { const n = p.title[0]?.length ?? 0; return n > T.titleMaxChars ? F(`${n} characters (max ${T.titleMaxChars})`) : n < T.titleMinChars ? `${n} characters (min ${T.titleMinChars})` : true; });
check(C, 'meta-description-present', 'Meta Description Present', 'fail', (p) => (p.desc[0] ?? '').length > 0 || 'no meta description');
check(C, 'meta-description-length', 'Meta Description Length', 'warn', (p) => { const n = p.desc[0]?.length ?? 0; return n >= T.descMinChars && n <= T.descMaxChars || `${n} characters (${T.descMinChars}–${T.descMaxChars})`; });
check(C, 'canonical-present', 'Canonical URL Present', 'fail', (p) => p.canonical.length > 0 || 'no canonical');
check(C, 'canonical-valid', 'Canonical URL Valid', 'fail', (p) => p.canonical.every((c) => /^https:\/\/\S+$/.test(c)) || `not an absolute https URL: ${p.canonical}`);
check(C, 'viewport', 'Viewport Meta Tag', 'fail', (p) => /<meta[^>]+name="viewport"/i.test(p.head) || 'no viewport meta');
check(C, 'favicon', 'Favicon Present', 'fail', (p) => /<link[^>]+rel="[^"]*icon[^"]*"/i.test(p.head) || 'no icon link');
check(C, 'h1-present', 'H1 Tag Present', 'fail', (p) => p.h1.length > 0 && p.h1[0].length > 0 || 'no <h1>');
check(C, 'single-h1', 'Single H1 Tag', 'fail', (p) => p.h1.length <= 1 || `${p.h1.length} <h1> tags`);
check(C, 'robots-meta', 'Robots Meta Directives', 'fail', (p) => {
  if (!production) return /noindex/.test(p.robots) || 'preview build without noindex';
  return p.heldNoindex || !/noindex|none/.test(p.robots) || `"${p.robots}" on a page meant to be indexed`;
});
check(C, 'no-snippet-blocking', 'No Snippet Blocking', 'fail', (p) => !/nosnippet|max-snippet:\s*0/.test(p.robots) || 'snippets blocked');
check(C, 'canonical-header', 'Canonical Header Validation', 'fail', () => !/^\s+Link:.*rel="?canonical/im.test(headersText) || 'canonical also sent as a Link header');
check(C, 'conflicting-canonicals', 'Conflicting Canonical URLs', 'fail', (p) => new Set(p.canonical).size <= 1 || `${new Set(p.canonical).size} different canonicals`);
check(C, 'canonical-not-homepage', 'Canonical Not Pointing to Homepage', 'fail', (p) => p.route === '/' || p.canonical.every((c) => pathOf(c) !== '/') || 'inner page canonicalised to the homepage');
check(C, 'canonical-protocol', 'Canonical Protocol Match', 'fail', (p) => p.canonical.every((c) => c.startsWith('https://')) || 'canonical is not https');
check(C, 'canonical-self', 'Canonical Loop Detection', 'fail', (p) => p.heldNoindex || p.canonical.every((c) => c === siteUrl + p.route) || `canonical ${p.canonical[0]} ≠ ${siteUrl + p.route}`);
check(C, 'canonical-noindex', 'Canonical and Noindex Conflict', 'fail', (p) => !(p.heldNoindex && p.canonical.some((c) => c !== siteUrl + p.route)) || 'noindex page canonicalised elsewhere');

const CT = 'content';
const CALENDAR = new Set(('january february march april may june july august september october november december ' +
  'monday tuesday wednesday thursday friday saturday sunday').split(' '));
check(CT, 'keyword-stuffing', 'Keyword Stuffing Check', 'fail', (p) => {
  const all = meaningful(p.text);
  if (all.length < T.densityMinWords) return true;
  const count = (list, f) => list.reduce((m, w) => m.set(f(w), (m.get(f(w)) || 0) + 1), new Map());
  const exact = count(all, (w) => w);
  const stems = count(all, stem);
  const pct = (n) => (100 * n) / all.length;
  const row = keywordMap.get(p.route);
  // The site name is a brand, not a keyword: "About Acme Recipes" doesn't make "recipes" a target term.
  const brandless = (s) => (config.siteName ? s.split(config.siteName).join(' ') : s);
  const targets = new Set(meaningful([brandless(p.title[0] ?? ''), brandless(p.h1[0] ?? ''), row?.primary ?? ''].join(' ')));
  const problems = [];
  for (const t of targets) {
    const e = pct(exact.get(t) || 0);
    const s = pct(stems.get(stem(t)) || 0);
    if (e > T.targetDensityFail) problems.push(F(`target "${t}" at ${e.toFixed(2)}% of ${all.length} words (max ${T.targetDensityFail}%)`));
    else if (s > T.targetStemFail) problems.push(F(`target "${stem(t)}*" (all forms) at ${s.toFixed(2)}% (max ${T.targetStemFail}%)`));
    else if (e > T.targetDensityWarn) problems.push(W(`target "${t}" at ${e.toFixed(2)}% (aim under ${T.targetDensityWarn}%)`));
  }
  // Month and weekday names in a date table are data, and they move with the build date (the daily rebuild), so on
  // their own they only warn; the fail rule judges the most frequent other word.
  const ranked = [...exact].sort((a, b) => b[1] - a[1]);
  const [topWord, topN] = ranked.find(([w]) => !CALENDAR.has(w)) ?? ranked[0];
  if (pct(topN) > T.anyWordDensityFail) problems.push(F(`"${topWord}" at ${pct(topN).toFixed(2)}% (any word, max ${T.anyWordDensityFail}%)`));
  else if (pct(topN) > T.anyWordDensityWarn && !targets.has(topWord)) problems.push(W(`"${topWord}" at ${pct(topN).toFixed(2)}% (any word, aim under ${T.anyWordDensityWarn}%)`));
  const [dateWord, dateN] = ranked.find(([w]) => CALENDAR.has(w)) ?? [];
  if (dateWord && pct(dateN) > T.anyWordDensityWarn && !targets.has(dateWord)) problems.push(W(`"${dateWord}" at ${pct(dateN).toFixed(2)}% (a date name in the page's data: a warning, aim under ${T.anyWordDensityWarn}%)`));
  return problems.find((x) => x.level === 'fail') ?? problems[0] ?? true;
});
check(CT, 'text-html-ratio', 'Text-to-HTML Ratio', 'warn', (p) => { const r = (100 * Buffer.byteLength(p.text)) / Buffer.byteLength(p.html); return r >= T.textHtmlRatioMin || `${r.toFixed(1)}% (min ${T.textHtmlRatioMin}%)`; });
check(CT, 'reading-level', 'Content Reading Level', 'warn', (p) => {
  const w = words(p.mainBlocks);
  if (w.length < T.densityMinWords) return true;
  const sentences = Math.max(1, (p.mainBlocks.match(/[.!?](?=\s|$)/g) || []).length);
  const grade = 0.39 * (w.length / sentences) + 11.8 * (w.reduce((n, x) => n + syllables(x), 0) / w.length) - 15.59;
  return grade <= T.readingGradeMax || `grade ${grade.toFixed(1)} (aim for ${T.readingGradeMax} or below)`;
});
check(CT, 'meta-description-pixels', 'Meta Description Pixel Width', 'warn', (p) => { const w = pixelWidth(p.desc[0] ?? ''); return w <= T.descMaxPx || `~${w.toFixed(1)}px (max ${T.descMaxPx}px)`; });
check(CT, 'link-density', 'Article Link Density', 'warn', (p) => {
  const all = words(p.mainText).length;
  if (all < T.densityMinWords) return true;
  const linked = elements(p.main, 'a').reduce((n, e) => n + words(textOf(e.inner)).length, 0);
  const d = (100 * linked) / all;
  return d <= T.linkDensityMax || `${d.toFixed(1)}% of the main text is links (max ${T.linkDensityMax}%)`;
});
check(CT, 'word-count', 'Content Word Count', 'warn', (p) => { const n = meaningful(p.text).length; return n >= T.minWords || `${n} meaningful words (aim for ${T.minWords}+)`; });
check(CT, 'heading-hierarchy', 'Heading Hierarchy', 'fail', (p) => { for (let i = 1; i < p.headings.length; i++) if (p.headings[i].level > p.headings[i - 1].level + 1) return `h${p.headings[i - 1].level} → h${p.headings[i].level} ("${p.headings[i].text}")`; return p.headings[0]?.level === 1 || p.headings.length === 0 || `first heading is h${p.headings[0].level}`; });
check(CT, 'heading-length', 'Heading Length', 'warn', (p) => { const bad = p.headings.find((h) => !h.text || h.text.length > T.headingMaxChars); return !bad || (bad.text ? `"${bad.text.slice(0, 40)}…" ${bad.text.length} chars` : F('empty heading')); });
check(CT, 'title-h1-duplicate', 'Title vs H1 Duplication', 'warn', (p) => (p.title[0] ?? '').trim().toLowerCase() !== (p.h1[0] ?? '').trim().toLowerCase() || 'title and H1 are identical');
check(CT, 'title-pixels', 'Title Pixel Width', 'warn', (p) => { const w = pixelWidth(p.title[0] ?? ''); return w <= T.titleMaxPx || `~${w.toFixed(1)}px (max ${T.titleMaxPx}px)`; });
check(CT, 'html-structure', 'Broken HTML Structure', 'fail', (p) => {
  for (const t of ['div', 'section', 'main', 'nav', 'header', 'footer', 'ul', 'ol', 'table', 'article', 'aside', 'form']) {
    const open = (p.body.match(new RegExp(`<${t}\\b`, 'gi')) || []).length;
    const close = (p.body.match(new RegExp(`</${t}>`, 'gi')) || []).length;
    if (open !== close) return `<${t}> opened ${open}, closed ${close}`;
  }
  return (p.html.match(/<body\b/gi) || []).length === 1 || 'more than one <body>';
});
check(CT, 'meta-in-body', 'Meta Tags in Body', 'fail', (p) => !/<meta\s(?![^>]*itemprop)/i.test(p.body) || '<meta> outside <head>');
check(CT, 'mime-type', 'Content MIME Type', 'fail', (p) => p.file.endsWith('.html') || 'not served as HTML');

const P = 'performance';
check(P, 'render-blocking', 'Render-Blocking Resources', 'warn', (p) => {
  const js = p.scripts.filter((s) => s.inHead && s.a.src !== undefined && !('async' in s.a) && !('defer' in s.a) && s.a.type !== 'module' && !('nomodule' in s.a));
  const css = tags(p.head, 'link').filter((t) => (t.a.rel || '') === 'stylesheet' && !(t.a.media && t.a.media !== 'all'));
  return js.length + css.length <= T.renderBlockingMax || `${js.length} blocking script(s), ${css.length} stylesheet(s) in <head>`;
});
check(P, 'page-weight', 'Page Weight', 'warn', (p) => { const kb = Buffer.byteLength(p.html) / 1024; return kb > T.htmlBudgetKb ? F(`HTML ${kb.toFixed(0)} KB (budget ${T.htmlBudgetKb} KB)`) : kb <= T.htmlWarnKb || `HTML ${kb.toFixed(0)} KB (recommended under ${T.htmlWarnKb} KB)`; });
check(P, 'inline-js', 'Inline JS Size', 'warn', (p) => { const kb = p.scripts.filter((s) => s.a.src === undefined && !/ld\+json/.test(s.a.type || '')).reduce((n, s) => n + Buffer.byteLength(s.content), 0) / 1024; return kb > T.inlineJsBudgetKb ? F(`${kb.toFixed(0)} KB inline JS (budget ${T.inlineJsBudgetKb} KB)`) : kb <= T.inlineJsWarnKb || `${kb.toFixed(0)} KB inline JS (recommended under ${T.inlineJsWarnKb} KB)`; });
check(P, 'dom-size', 'DOM Size', 'warn', (p) => { const n = (p.body.match(/<[a-z][a-z0-9-]*\b/gi) || []).length; return n > T.domFail ? F(`${n} elements (max ${T.domFail})`) : n <= T.domWarn || `${n} elements (aim under ${T.domWarn})`; });
check(P, 'preconnect', 'Preconnect Hints', 'warn', (p) => {
  const hosts = new Set([...p.scripts.map((s) => s.a.src), ...tags(p.head, 'link').map((t) => t.a.href)].filter((u) => u && isExternal(u)).map((u) => new URL(u).origin));
  const pre = new Set(tags(p.head, 'link').filter((t) => /preconnect|dns-prefetch/.test(t.a.rel || '')).map((t) => { try { return new URL(t.a.href).origin; } catch { return ''; } }));
  const missing = [...hosts].filter((h) => !pre.has(h));
  return missing.length === 0 || `no preconnect for ${missing.join(', ')}`;
});
check(P, 'font-loading', 'Font Loading Optimization', 'warn', (p) => { const faces = p.styles.join('\n').match(/@font-face\s*\{[^}]*\}/g) || []; const bad = faces.filter((f) => !/font-display\s*:\s*(?:swap|optional|fallback)/.test(f)); return bad.length === 0 || `${bad.length} @font-face without font-display`; });
check(P, 'lazy-above-fold', 'No Lazy Loading Above Fold', 'warn', (p) => p.images[0]?.a.loading !== 'lazy' || 'first image is loading="lazy"');
check(P, 'lcp-hints', 'LCP Optimization Hints', 'warn', (p) => { const first = p.images[0]; return !first || first.a.fetchpriority === 'high' || /<link[^>]+rel="preload"[^>]+as="image"/i.test(p.head) || 'first image has no fetchpriority="high" or preload'; });
check(P, 'css-size', 'CSS File Size', 'warn', (p) => { const kb = p.styles.reduce((n, s) => n + Buffer.byteLength(s), 0) / 1024; return kb <= T.inlineCssMaxKb || `${kb.toFixed(0)} KB inline CSS (max ${T.inlineCssMaxKb} KB)`; });
check(P, 'cache-policy', 'Cache Policy', 'warn', () => /\/_next\/static\/\*[\t\v\f\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*\n\s+Cache-Control:.*immutable/i.test(headersText) || !existsSync(join(OUT, '_next')) || 'no long-lived Cache-Control for hashed assets in _headers');
check(P, 'minify-css', 'Minify Inline CSS', 'warn', (p) => p.styles.every((s) => s.length < 500 || (s.match(/\n/g) || []).length / s.length < 0.01) || 'inline CSS is not minified');
check(P, 'minify-js', 'Minify Inline JS', 'warn', (p) => p.scripts.filter((s) => s.a.src === undefined && s.content.length > 500 && !/json/.test(s.a.type || '')).every((s) => (s.content.match(/\n {2,}/g) || []).length / s.content.length < 0.005) || 'inline JS is not minified');
check(P, 'no-gif', 'Video Instead of GIF', 'warn', (p) => !p.images.some((i) => /\.gif(?:\?|$)/i.test(i.a.src || '')) || 'animated GIF found');

const L = 'links';
const GENERIC = new Set(['click here', 'here', 'more', 'read more', 'learn more', 'link', 'this', 'go', 'details', 'continue']);
check(L, 'descriptive-anchors', 'Descriptive Anchor Text', 'warn', (p) => {
  const bad = p.links.filter((l) => l.href !== null).map((l) => ({ l, t: (l.text || l.alt).trim() }));
  const empty = bad.filter(({ l, t }) => !t && !l.a['aria-label']);
  if (empty.length) return F(`${empty.length} link(s) with no text: ${empty[0].l.href}`);
  const weak = bad.filter(({ t }) => !t ? true : GENERIC.has(t.toLowerCase()));
  return weak.length === 0 || `${weak.length} link(s) with no visible text or generic text: ${weak[0].l.href} "${weak[0].t || weak[0].l.a['aria-label']}"`;
});
// SEO tools read a link's text as textContent: tags removed with nothing in their place, so <span>Pets</span><span>1</span>
// is the anchor "Pets1" (found on calculatorporch.com's nav, 2026-10-27). Compare that with the text read tag by tag.
check(L, 'joined-anchor-text', 'Anchor Text Not Run Together', 'fail', (p) => {
  const joined = p.links.filter((l) => l.href !== null).map((l) => {
    const raw = decode(l.inner.replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    return { href: l.href, raw, spaced: l.text };
  }).filter(({ raw, spaced }) => raw && raw.split(' ').length < spaced.split(' ').length);
  return joined.length === 0 || `${joined.length} link(s) whose text runs together for crawlers: ${joined[0].href} reads "${joined[0].raw}", not "${joined[0].spaced}"`;
});
check(L, 'fragment-targets', 'Fragment Link Targets', 'fail', (p) => {
  for (const l of p.links) {
    const [path, frag] = (l.href || '').split('#');
    if (!frag || /^https?:/.test(path)) continue;
    const target = path ? (path.endsWith('/') ? path : path + '/') : p.route;
    if (byRoute.has(target) && !ids.get(target).has(frag)) return `#${frag} not found on ${target}`;
  }
  return true;
});
check(L, 'invalid-links', 'Invalid Links', 'fail', (p) => { const bad = p.links.filter((l) => l.href === '' || /^javascript:/i.test(l.href ?? '') || l.href === '#'); return bad.length === 0 || `${bad.length} empty, "#" or javascript: link(s)`; });
check(L, 'broken-internal', 'Broken Internal Links', 'fail', (p) => { const bad = p.links.map((l) => l.href).filter((h) => h && h.startsWith('/') && !h.startsWith('//')).map(pathOf).filter((h) => !existsPath(h)); return bad.length === 0 || `links to missing ${[...new Set(bad)].slice(0, 3).join(', ')}`; });
check(L, 'link-count', 'Excessive Link Count', 'warn', (p) => p.links.length <= T.maxLinks || `${p.links.length} links (max ${T.maxLinks})`);
check(L, 'no-localhost', 'No Localhost Links', 'fail', (p) => !/(?:href|src)="https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(p.html) || 'localhost reference');
check(L, 'no-local-file', 'No Local File Links', 'fail', (p) => !/(?:href|src)="(?:file:|[a-z]:\\)/i.test(p.html) || 'local file path');
check(L, 'no-onclick-nav', 'No onclick Navigation', 'fail', (p) => !/onclick="[^"]*(?:location|window\.open)/i.test(p.html) || 'onclick navigation');
check(L, 'clean-hrefs', 'Clean Link HREFs', 'fail', (p) => !p.links.some((l) => /\s/.test(l.href ?? '')) || 'whitespace in an href');
check(L, 'no-https-downgrade', 'No HTTPS Downgrade', 'fail', (p) => !p.links.some((l) => /^http:\/\//i.test(l.href ?? '')) || 'http:// link');
check(L, 'external-count', 'External Link Count', 'warn', (p) => p.links.filter((l) => isExternal(l.href ?? '')).length <= T.maxExternalLinks || 'too many external links');
check(L, 'internal-present', 'Internal Links Present', 'fail', (p) => p.links.some((l) => (l.href ?? '').startsWith('/')) || 'no internal links');
check(L, 'nofollow-internal', 'Appropriate Nofollow Usage', 'fail', (p) => !p.links.some((l) => (l.href ?? '').startsWith('/') && /nofollow/.test(l.a.rel || '')) || 'nofollow on an internal link');
check(L, 'tel-mailto', 'Valid Phone & Email Links', 'fail', (p) => p.links.filter((l) => /^(?:tel|mailto):/i.test(l.href ?? '')).every((l) => /^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}/i.test(l.href) || /^tel:\+?[\d\s().-]{6,}$/i.test(l.href)) || 'malformed tel: or mailto:');
check(L, 'url-depth', 'URL Depth', 'fail', (p) => p.route.split('/').filter(Boolean).length <= T.maxUrlDepth || `depth ${p.route.split('/').filter(Boolean).length}`);
check(L, 'no-dead-end', 'No Dead-End Pages', 'fail', (p) => p.links.some((l) => (l.href ?? '').startsWith('/') && pathOf(l.href) !== p.route) || 'no outgoing internal link');

const I = 'images';
check(I, 'alt-present', 'Image Alt Attributes Present', 'fail', (p) => p.images.every((i) => 'alt' in i.a) || `${p.images.filter((i) => !('alt' in i.a)).length} <img> without alt`);
check(I, 'alt-quality', 'Image Alt Text Quality', 'warn', (p) => !p.images.some((i) => /^(?:image|img|photo|picture|graphic|untitled)$|\.(?:png|jpe?g|webp|gif|svg)$/i.test((i.a.alt || '').trim())) || 'alt text is a file name or a placeholder word');
check(I, 'alt-length', 'Image Alt Text Length', 'warn', (p) => p.images.every((i) => (i.a.alt || '').length <= 125) || 'alt text over 125 characters');
check(I, 'dimensions', 'Image Dimensions Specified', 'warn', (p) => p.images.every((i) => i.a.width && i.a.height) || 'image without width and height');
check(I, 'lazy-loading', 'Image Lazy Loading', 'warn', (p) => p.images.length <= 3 || p.images.slice(3).every((i) => i.a.loading === 'lazy') || 'offscreen images not lazy-loaded');
check(I, 'modern-formats', 'Modern Image Formats', 'warn', (p) => !p.images.some((i) => /\.(?:jpe?g|png|bmp)(?:\?|$)/i.test(i.a.src || '') && !/og\//.test(i.a.src)) || 'JPEG/PNG where WebP or AVIF would do');
check(I, 'srcset', 'Responsive Images (srcset)', 'warn', (p) => !p.images.some((i) => Number(i.a.width) > 600 && !i.a.srcset) || 'large image without srcset');
check(I, 'figure-captions', 'Figure Captions Present', 'warn', (p) => elements(p.body, 'figure').every((f) => /<figcaption\b/i.test(f.inner)) || '<figure> without <figcaption>');
check(I, 'filename-quality', 'Image Filename Quality', 'warn', (p) => !p.images.some((i) => /(?:IMG|DSC|image|screenshot)[-_]?\d+/i.test(i.a.src || '')) || 'camera-style image file name');
check(I, 'inline-svg-size', 'Inline SVG Size', 'warn', (p) => [...p.body.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].every((m) => m[0].length < 100 * 1024) || 'inline SVG over 100 KB');
check(I, 'picture-fallback', 'Picture Element Fallback', 'fail', (p) => elements(p.body, 'picture').every((e) => /<img\b/i.test(e.inner)) || '<picture> without <img>');
check(I, 'css-background', 'CSS Background Images for Content', 'warn', (p) => !/style="[^"]*background(?:-image)?\s*:\s*url\(/i.test(p.body) || 'inline background-image (content images should be <img>)');
check(I, 'dimension-size', 'Image Dimensions Size', 'warn', (p) => p.images.every((i) => !i.a.width || Number(i.a.width) <= 4000) || 'image declared wider than 4000px');
check(I, 'broken-images', 'Broken Image Detection', 'fail', (p) => { const bad = p.images.map((i) => i.a.src).filter((s) => s && s.startsWith('/') && !existsSync(join(OUT, s.split('?')[0]))); return bad.length === 0 || `missing ${bad[0]}`; });

const S = 'security';
check(S, 'hsts-details', 'TLS Configuration', 'warn', () => { const v = (headersText.match(/Strict-Transport-Security:\s*(.+)/i) || [, ''])[1]; return /includeSubDomains/i.test(v) && /preload/i.test(v) || `HSTS "${v || 'missing'}" without includeSubDomains or preload`; }, { scope: 'site' });
check(S, 'https', 'HTTPS', 'fail', () => siteUrl.startsWith('https://') || 'site URL is not https', { scope: 'site' });
check(S, 'hsts', 'HSTS Header', 'fail', () => /Strict-Transport-Security:\s*max-age=\d+/i.test(headersText) || 'no HSTS in _headers', { scope: 'site' });
check(S, 'csp', 'Content Security Policy', 'fail', () => !!globalHeaders['content-security-policy'] || 'no CSP for /*', { scope: 'site' });
check(S, 'x-frame-options', 'X-Frame-Options', 'fail', () => !!globalHeaders['x-frame-options'] || /frame-ancestors/.test(globalHeaders['content-security-policy'] || '') || 'no X-Frame-Options or frame-ancestors', { scope: 'site' });
check(S, 'x-content-type', 'X-Content-Type-Options', 'fail', () => (globalHeaders['x-content-type-options'] || '').toLowerCase() === 'nosniff' || 'no nosniff', { scope: 'site' });
check(S, 'blank-noopener', 'External Links Security', 'fail', (p) => p.links.filter((l) => l.a.target === '_blank').every((l) => /noopener|noreferrer/.test(l.a.rel || '')) || 'target="_blank" without rel="noopener"');
check(S, 'form-https', 'Form HTTPS Actions', 'fail', (p) => tags(p.body, 'form').every((f) => !f.a.action || !/^http:/i.test(f.a.action)) || 'form posts over http');
check(S, 'mixed-content', 'Mixed Content', 'fail', (p) => !/(?:src|srcset|poster|data)="http:\/\//i.test(p.html) && !/<link[^>]+href="http:\/\//i.test(p.html) || 'http:// resource');
check(S, 'permissions-policy', 'Permissions Policy', 'fail', () => !!globalHeaders['permissions-policy'] || 'no Permissions-Policy', { scope: 'site' });
check(S, 'referrer-policy', 'Referrer Policy', 'fail', () => !!globalHeaders['referrer-policy'] || 'no Referrer-Policy', { scope: 'site' });
check(S, 'leaked-secrets', 'No Leaked Secrets', 'fail', (p) => !/AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|sk_live_[0-9a-zA-Z]{24}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-[A-Za-z0-9-]{10,}/.test(p.html) || 'secret-shaped string in the HTML');
check(S, 'password-http', 'No Password Fields on HTTP', 'fail', (p) => !/type="password"/i.test(p.body) || siteUrl.startsWith('https://') || 'password field on http');
check(S, 'protocol-relative', 'No Protocol-Relative URLs', 'fail', (p) => !/(?:src|href)="\/\/[^/]/i.test(p.html) || 'protocol-relative URL');

const A = 'accessibility';
check(A, 'focus-visible', 'Focus Visible Styles', 'warn', (p) => { const rules = p.styles.join('\n').match(/[^{}]+\{[^{}]*outline\s*:\s*(?:none|0)\b[^{}]*\}/g) || []; const bad = rules.filter((r) => !/box-shadow|border(?:-color)?\s*:|outline-color/.test(r)); return bad.length === 0 || `${bad.length} rule(s) remove the outline without a replacement: ${bad[0].split('{')[0].trim().slice(0, 60)}`; });
check(A, 'interactive-labels', 'Interactive Element Labels', 'fail', (p) => { const bad = elements(p.body, 'button').filter((b) => !textOf(b.inner) && !b.a['aria-label'] && !b.a['aria-labelledby'] && !b.a.title); return bad.length === 0 || `${bad.length} button(s) without a name`; });
check(A, 'contrast-heuristic', 'Color Contrast (Heuristic)', 'warn', (p) => !/style="[^"]*color\s*:\s*#[ef]{3}[^"]*background(?:-color)?\s*:\s*#f{3}(?:f{3})?/i.test(p.body) || 'inline light-on-light colours');
check(A, 'form-labels', 'Form Input Labels', 'fail', (p) => { const labelled = new Set(tags(p.body, 'label').map((l) => l.a.for)); const bad = tags(p.body, 'input').filter((i) => !/hidden|submit|button|reset|image/.test(i.a.type || '') && !i.a['aria-label'] && !i.a['aria-labelledby'] && !labelled.has(i.a.id)); return bad.length === 0 || `${bad.length} input(s) without a label`; });
check(A, 'heading-order', 'Heading Level Order', 'fail', (p) => { for (let i = 1; i < p.headings.length; i++) if (p.headings[i].level > p.headings[i - 1].level + 1) return 'heading level skipped'; return true; });
check(A, 'landmarks', 'Landmark Regions', 'fail', (p) => ['<main', '<nav', '<header', '<footer'].every((t) => p.body.includes(t)) || 'missing main, nav, header or footer');
check(A, 'link-text', 'Link Discernible Text', 'fail', (p) => p.links.filter((l) => l.href !== null).every((l) => l.text || l.alt || l.a['aria-label'] || l.a['aria-labelledby']) || 'link without an accessible name');
check(A, 'skip-link', 'Skip Navigation Link', 'fail', (p) => { const first = p.links.find((l) => (l.href ?? '').startsWith('#')); return !!first && ids.get(p.route).has(first.href.slice(1)) || 'no working skip link'; });
check(A, 'table-headers', 'Table Headers', 'fail', (p) => elements(p.body, 'table').every((t) => /<th\b/i.test(t.inner)) || 'table without <th>');
check(A, 'touch-targets', 'Touch Target Size', 'warn', (p) => !/<(?:a|button)\s[^>]*style="[^"]*(?:width|height)\s*:\s*(?:1?\d|2[0-3])px/i.test(p.body) || 'inline-sized target under 24px');
check(A, 'video-captions', 'Video Captions', 'fail', (p) => elements(p.body, 'video').every((v) => /<track\s[^>]*kind="(?:captions|subtitles)"/i.test(v.inner)) || '<video> without captions');
check(A, 'zoom', 'Zoom Not Disabled', 'fail', (p) => { const v = (p.head.match(/<meta[^>]+name="viewport"[^>]+content="([^"]+)"/i) || [, ''])[1]; return !/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\.0)?\b/i.test(v) || `viewport "${v}" blocks zoom`; });

const SD = 'structured-data';
const nodesOf = (d) => (Array.isArray(d) ? d.flatMap(nodesOf) : d && typeof d === 'object' ? (d['@graph'] ? d['@graph'].flatMap(nodesOf) : [d]) : []);
const REQUIRED = { Organization: ['name', 'url'], WebSite: ['name', 'url'], WebPage: ['name'], CollectionPage: ['name'], BreadcrumbList: ['itemListElement'], FAQPage: ['mainEntity'], Article: ['headline'], Person: ['name'], ItemList: ['itemListElement'], WebApplication: ['name'], SoftwareApplication: ['name'], HowTo: ['name', 'step'] };
check(SD, 'present', 'Structured Data Present', 'fail', (p) => p.jsonld.length > 0 || 'no JSON-LD');
check(SD, 'valid-json', 'Structured Data Valid JSON', 'fail', (p) => p.jsonld.every((j) => j.ok) || `invalid JSON-LD: ${p.jsonld.find((j) => !j.ok).error}`);
check(SD, 'type-present', 'Schema Type Present', 'fail', (p) => { const bad = p.jsonld.filter((j) => j.ok).flatMap((j) => nodesOf(j.data)).filter((n) => !n['@type']); return bad.length === 0 || `${bad.length} node(s) without @type`; });
check(SD, 'required-fields', 'Required Schema Fields', 'fail', (p) => { for (const n of p.jsonld.filter((j) => j.ok).flatMap((j) => nodesOf(j.data))) for (const t of [].concat(n['@type'])) for (const f of REQUIRED[t] || []) if (n[f] === undefined || (Array.isArray(n[f]) && !n[f].length)) return `${t} missing ${f}`; return true; });

const SO = 'social';
check(SO, 'share-buttons', 'Social Share Buttons', 'warn', (p) => /twitter\.com\/intent|facebook\.com\/sharer|linkedin\.com\/share|navigator\.share|wa\.me\//i.test(p.html) || 'no share links');
check(SO, 'profile-links', 'Social Media Profile Links', 'warn', (p) => /href="https:\/\/(?:www\.)?(?:twitter|x|facebook|linkedin|instagram|youtube|github|tiktok|pinterest)\.com\//i.test(p.html) || p.jsonld.some((j) => j.ok && nodesOf(j.data).some((n) => n.sameAs?.length)) || 'no social profile links');
check(SO, 'og-title', 'Open Graph Title', 'fail', (p) => !!p.og('og:title') || 'no og:title');
check(SO, 'og-description', 'Open Graph Description', 'fail', (p) => !!p.og('og:description') || 'no og:description');
check(SO, 'og-image', 'Open Graph Image', 'fail', (p) => !!p.og('og:image') || 'no og:image');
check(SO, 'og-image-format', 'Open Graph Image Format', 'fail', (p) => /\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(p.og('og:image') || '') || 'og:image has no image extension');
check(SO, 'og-url', 'Open Graph URL', 'fail', (p) => !!p.og('og:url') || 'no og:url');
check(SO, 'og-url-canonical', 'OG URL Matches Canonical', 'fail', (p) => !p.og('og:url') || p.og('og:url') === p.canonical[0] || `og:url ${p.og('og:url')} ≠ canonical`);
check(SO, 'twitter-card', 'Twitter Card Meta Tag', 'fail', (p) => !!p.og('twitter:card') || 'no twitter:card');

const E = 'eeat';
const authorBio = (() => { const a = pages.find((p) => p.route.startsWith(config.authorPathPrefix)); return a ? meaningful(a.mainText).length >= T.authorBioMinWords : false; })();
const linksTo = (p, path) => p.links.some((l) => pathOf(l.href ?? '') === path);
check(E, 'author-expertise', 'Author Expertise Signals', 'warn', (p) => (authorBio && p.links.some((l) => pathOf(l.href ?? '').startsWith(config.authorPathPrefix))) || 'no link to an author page with a bio');
// Pages that make factual claims (the homepage and every keyword-map page: tools, guides, worked answers).
check(E, 'external-citations', 'External Citations', 'warn', (p) => !(p.route === '/' || keywordMap.has(p.route)) || p.links.some((l) => isExternal(l.href ?? '')) || 'no links to outside sources');
check(E, 'content-dates', 'Content Dates', 'warn', (p) => /<time\s[^>]*datetime=/i.test(p.main) || p.jsonld.some((j) => j.ok && nodesOf(j.data).some((n) => n.dateModified || n.datePublished)) || 'no visible <time> or dateModified');
check(E, 'physical-address', 'Physical Address', 'warn', (p) => /<address\b/i.test(p.body) || p.jsonld.some((j) => j.ok && nodesOf(j.data).some((n) => n.address)) || 'no physical address');
check(E, 'trust-signals', 'Trust Signals', 'warn', (p) => p.jsonld.some((j) => j.ok && nodesOf(j.data).some((n) => n.aggregateRating || n.review || n.award)) || 'no badges, reviews or awards in markup');
check(E, 'disclaimers', 'Disclaimers', 'fail', (p) => /disclaimer|not (?:professional|financial|legal|medical|veterinary|tax)[^.]{0,40}advice/i.test(p.text) || 'no visible disclaimer');
for (const [id, name, path] of [['about', 'About Page Link', '/about/'], ['contact', 'Contact Page Link', '/contact/'], ['privacy', 'Privacy Policy', '/privacy/'], ['terms', 'Terms of Service', '/terms/'], ['editorial', 'Editorial Policy', config.editorialPath]]) {
  check(E, `${id}-link`, name, 'fail', (p) => linksTo(p, path) || `no link to ${path}`);
}
check(E, 'author-byline', 'Author Byline', 'fail', (p) => p.links.some((l) => pathOf(l.href ?? '').startsWith(config.authorPathPrefix)) || 'no author link');
check(E, 'affiliate-disclosure', 'Affiliate Disclosure', 'fail', (p) => !p.links.some((l) => /sponsored/.test(l.a.rel || '') || /[?&](?:tag|aff|affiliate|ref)=/.test(l.href ?? '')) || linksTo(p, config.disclosurePath) || 'affiliate links without a disclosure link');
check(E, 'ymyl', 'YMYL Detection', 'warn', (p) => !/\b(?:mortgage|loan|invest(?:ing|ment)|diagnos|dosage|medication|lawsuit)\b/i.test(p.mainText) || /disclaimer|not [^.]{0,30}advice/i.test(p.text) || 'YMYL topic without a disclaimer');

const U = 'url';
const slug = (p) => p.route.split('/').filter(Boolean).pop() ?? '';
// Exact words, title only: Ubersuggest flags a "poorly formatted URL" when the slug's words (/pets/) aren't in the title ("Pet …").
check(U, 'slug-keywords', 'URL Slug Keywords', 'warn', (p) => { const s = slug(p).split('-').filter((w) => w.length > 2 && !/^\d+$/.test(w)); if (!s.length) return true; const t = new Set(words(p.title[0] ?? '')); return s.filter((w) => t.has(w)).length / s.length >= 0.5 || `URL words "${slug(p)}" barely appear in the title`; });
check(U, 'stop-words', 'No Stop Words in URL', 'warn', (p) => !slug(p).split('-').some((w) => ['a', 'an', 'the', 'and', 'or', 'of', 'in', 'to', 'for', 'from', 'on', 'at', 'by', 'with', 'is'].includes(w)) || `stop word in "${slug(p)}"`);
check(U, 'lowercase', 'No Uppercase in URL', 'fail', (p) => p.route === p.route.toLowerCase() || 'uppercase in URL');
check(U, 'underscores', 'No Underscores in URL', 'warn', (p) => !p.route.includes('_') || p.is404 || 'underscore in URL');
check(U, 'double-slash', 'No Double Slash in Path', 'fail', (p) => !p.route.includes('//') || 'double slash');
check(U, 'spaces', 'No Spaces in URL', 'fail', (p) => !/\s|%20/.test(p.route) || 'space in URL');
check(U, 'ascii', 'No Non-ASCII in URL', 'warn', (p) => /^[\x21-\x7e]*$/.test(p.route) || 'non-ASCII URL');
check(U, 'length', 'URL Length', 'warn', (p) => (siteUrl + p.route).length <= T.maxUrlLength || `${(siteUrl + p.route).length} characters`);
check(U, 'repetitive', 'No Repetitive Path Segments', 'warn', (p) => { const s = p.route.split('/').filter(Boolean); return new Set(s).size === s.length || 'repeated path segment'; });
check(U, 'parameters', 'URL Parameters', 'warn', (p) => !p.links.some((l) => (l.href ?? '').startsWith('/') && l.href.includes('?')) || 'internal links with query parameters');
check(U, 'session-ids', 'No Session IDs in URL', 'fail', (p) => !p.links.some((l) => /[?&;](?:sid|sessionid|jsessionid|phpsessid)=/i.test(l.href ?? '')) || 'session ID in a link');
check(U, 'tracking', 'No Tracking Parameters', 'fail', (p) => !p.links.some((l) => (l.href ?? '').startsWith('/') && /[?&](?:utm_|gclid|fbclid)/i.test(l.href)) || 'tracking parameters on internal links');
check(U, 'internal-search', 'No Internal Search URLs', 'warn', (p) => !/[?&](?:q|s|search|query)=/.test(p.route) || 'search results page');

const M = 'mobile';
check(M, 'font-size', 'Readable Font Size', 'warn', (p) => !/style="[^"]*font-size\s*:\s*(?:\d|1[01])px/i.test(p.body) || 'inline font size under 12px');
check(M, 'viewport-width', 'Viewport Uses device-width', 'fail', (p) => /<meta[^>]+name="viewport"[^>]+width=device-width/i.test(p.head) || 'viewport without width=device-width');
check(M, 'single-viewport', 'Single Viewport Tag', 'fail', (p) => (p.head.match(/name="viewport"/gi) || []).length === 1 || 'viewport tag count ≠ 1');
check(M, 'interstitials', 'No Intrusive Interstitials', 'warn', (p) => !/style="[^"]*position\s*:\s*fixed[^"]*(?:height\s*:\s*100v?h|inset\s*:\s*0)/i.test(p.body) || 'full-screen fixed overlay');
check(M, 'horizontal-scroll', 'No Horizontal Scroll', 'warn', (p) => !/style="[^"]*width\s*:\s*(?:[2-9]\d{3}|1[1-9]\d{2})px/i.test(p.body) || 'inline width wider than a phone');

const H = 'html';
check(H, 'doctype', 'DOCTYPE Declaration', 'fail', (p) => /^\s*<!doctype html>/i.test(p.html) || 'no <!DOCTYPE html>');
check(H, 'charset', 'Character Encoding', 'fail', (p) => /<meta charset="utf-8"/i.test(p.head) || 'no UTF-8 charset');
check(H, 'head-elements', 'Valid Head Elements', 'fail', (p) => { const bad = [...p.head.replace(/<(script|style|title|noscript|template)\b[\s\S]*?<\/\1>/gi, '').matchAll(/<([a-z][a-z0-9-]*)\b/gi)].map((m) => m[1].toLowerCase()).filter((t) => !['html', 'head', 'meta', 'link', 'title', 'style', 'script', 'base', 'noscript', 'template'].includes(t)); return bad.length === 0 || `<${bad[0]}> inside <head>`; });
check(H, 'noscript-head', 'Noscript in Head', 'warn', (p) => !/<noscript\b/i.test(p.head) || '<noscript> in <head>');
check(H, 'single-head', 'Single Head Element', 'fail', (p) => (p.html.match(/<head\b/gi) || []).length === 1 || 'head element count ≠ 1');
check(H, 'html-size', 'HTML Size Limit', 'fail', (p) => Buffer.byteLength(p.html) <= T.htmlMaxMb * 1024 * 1024 || `HTML over ${T.htmlMaxMb} MB`);
check(H, 'placeholder', 'No Placeholder Text', 'fail', (p) => !/\bTODO\b|lorem ipsum|coming soon|\[your [a-z]+\]/i.test(p.text) || 'placeholder text');
check(H, 'single-title', 'Single Title Element', 'fail', (p) => p.title.length === 1 || `${p.title.length} <title>`);
check(H, 'single-description', 'Single Meta Description', 'fail', (p) => p.desc.length === 1 || `${p.desc.length} meta descriptions`);

const R = 'redirects';
check(R, 'meta-refresh', 'No Meta Refresh Redirect', 'fail', (p) => !/<meta[^>]+http-equiv="refresh"/i.test(p.head) || 'meta refresh');
check(R, 'js-redirect', 'No JavaScript Redirect', 'warn', (p) => !p.scripts.some((s) => s.a.src === undefined && /\b(?:window\.)?location(?:\.href)?\s*=(?!=)|location\.replace\(/.test(s.content)) || 'inline script redirects');
check(R, 'refresh-header', 'No HTTP Refresh Header', 'fail', () => !/^\s+Refresh:/im.test(headersText) || 'Refresh header in _headers', { scope: 'site' });
check(R, 'redirect-type', 'Redirect Type', 'warn', () => !redirectsText.split('\n').some((l) => /\s302\s*$/.test(l.trim())) || '302 in _redirects (use 301/308 for permanent moves)', { scope: 'site' });
check(R, 'http-resources', 'No HTTP Resource URLs on HTTPS', 'fail', (p) => !/(?:src|href)="http:\/\/(?!www\.w3\.org)/i.test(p.html) || 'http:// resource URL');

const AI = 'ai-geo';
check(AI, 'semantic-html', 'Semantic HTML', 'warn', (p) => ['main', 'nav', 'header', 'footer', 'article', 'section', 'aside'].filter((t) => new RegExp(`<${t}\\b`, 'i').test(p.body)).length >= 3 || 'fewer than 3 semantic element types');
check(AI, 'content-structure', 'Content Structure for AI', 'warn', (p) => (p.main.match(/<(?:h[2-6]|ul|ol|table|dl)\b/gi) || []).length >= 3 || 'little structure (headings, lists, tables) in <main>');
check(AI, 'ai-bot-access', 'AI Bot Access', 'fail', () => {
  if (!production) return true; // previews disallow everything by design; production builds are checked
  const groups = robotsTxt.split(/\n(?=user-agent:)/i).map((g) => ({ agents: [...g.matchAll(/user-agent:\s*(\S+)/gi)].map((m) => m[1].toLowerCase()), disallowAll: /^disallow:\s*\/\s*$/im.test(g) }));
  const blocked = config.searchBots.filter((b) => { const g = groups.find((x) => x.agents.includes(b.toLowerCase())) ?? groups.find((x) => x.agents.includes('*')); return g?.disallowAll; });
  return blocked.length === 0 || `robots.txt blocks ${blocked.join(', ')}`;
}, { scope: 'site' });
check(AI, 'llms-txt', 'llms.txt Reference', 'warn', (p) => /href="\/llms\.txt"/i.test(p.html) || 'no link to /llms.txt');
check(AI, 'schema-drift', 'Schema Content Drift', 'warn', (p) => {
  const page = p.jsonld.filter((j) => j.ok).flatMap((j) => nodesOf(j.data)).find((n) => n.url === siteUrl + p.route && (n.name || n.headline));
  if (!page) return true;
  const want = meaningful(page.name || page.headline);
  const have = new Set(meaningful(`${p.title[0]} ${p.h1[0]} ${p.mainText.slice(0, 2000)}`));
  return want.filter((w) => have.has(w)).length / Math.max(1, want.length) >= 0.6 || `JSON-LD name "${page.name || page.headline}" doesn't match the visible page`;
});

const IN = 'i18n';
check(IN, 'lang', 'HTML Lang Attribute', 'fail', (p) => /^[a-z]{2}(?:-[A-Z]{2})?$/.test(p.lang) || `lang="${p.lang}"`);
check(IN, 'hreflang', 'Hreflang Tags', 'fail', (p) => tags(p.head, 'link').filter((t) => t.a.hreflang).every((t) => /^(?:x-default|[a-z]{2}(?:-[a-z]{2})?)$/i.test(t.a.hreflang) && /^https:\/\//.test(t.a.href)) || 'invalid hreflang');
check(IN, 'hreflang-noindex', 'No Hreflang on Noindex Pages', 'fail', (p) => !(p.heldNoindex && /hreflang=/i.test(p.head)) || 'hreflang on a noindex page');
check(IN, 'hreflang-self', 'Hreflang Self-Reference', 'fail', (p) => { const h = tags(p.head, 'link').filter((t) => t.a.hreflang); return h.length === 0 || h.some((t) => t.a.href === siteUrl + p.route) || 'hreflang set without a self-reference'; });

// ---------- live mode: what only a real response shows ----------
async function live(base, paths) {
  const results = [];
  const add = (id, name, level, ok, msg) => results.push({ id: `live.${id}`, name, status: ok ? 'pass' : level, msg: ok ? '' : msg });
  const get = (url) => fetch(url, { headers: { 'accept-encoding': 'br, gzip' }, redirect: 'manual' });
  for (const path of paths.length ? paths : ['/']) {
    // The first request pays for DNS and the TLS handshake; time a second one on the warm connection, as audit tools do.
    await (await get(base + path)).arrayBuffer();
    const t0 = performance.now();
    const res = await get(base + path);
    const ms = performance.now() - t0;
    const h = (k) => res.headers.get(k) || '';
    add(`${path}:status`, `Redirect Type ${path}`, 'fail', res.status === 200, `HTTP ${res.status}`);
    add(`${path}:mime`, `Content MIME Type ${path}`, 'fail', /^text\/html/.test(h('content-type')), h('content-type'));
    add(`${path}:compression`, `Text Compression ${path}`, 'fail', /br|gzip|zstd/.test(h('content-encoding')), `content-encoding "${h('content-encoding') || 'none'}"`);
    add(`${path}:brotli`, `Brotli Compression ${path}`, 'warn', /br|zstd/.test(h('content-encoding')), `content-encoding "${h('content-encoding') || 'none'}"`);
    add(`${path}:http3`, `HTTP/2+ Support ${path}`, 'warn', /h3/.test(h('alt-svc')), 'no alt-svc h3 (turn on HTTP/3 at the CDN)');
    add(`${path}:cache`, `Cache Policy ${path}`, 'warn', !!h('cache-control'), 'no Cache-Control');
    add(`${path}:time`, `Response Time ${path}`, 'warn', ms <= T.responseMsMax, `${ms.toFixed(0)} ms`);
    add(`${path}:hsts`, `HSTS Header ${path}`, 'fail', /max-age=\d+/.test(h('strict-transport-security')), 'no HSTS');
    add(`${path}:refresh`, `No HTTP Refresh Header ${path}`, 'fail', !h('refresh'), 'Refresh header');
    for (const k of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) add(`${path}:${k}`, `${k} ${path}`, 'fail', !!h(k), `no ${k}`);
  }
  const http = await fetch(base.replace('https://', 'http://') + '/', { redirect: 'manual' });
  add('http-redirect', 'HTTPS redirect', 'fail', [301, 308].includes(http.status) && (http.headers.get('location') || '').startsWith('https://'), `http:// answers ${http.status}`);
  return results;
}

// ---------- run ----------
function applyExceptions(route, id, status, msg) {
  if (status === 'pass') return { status, msg };
  const ex = config.exceptions.find((e) => e.check === id && (e.pages === '*' || e.pages.includes(route)));
  return ex ? { status: 'accepted', msg: `${msg} (accepted: ${ex.reason})` } : { status, msg };
}
const report = [];
if (flag('--live')) {
  const base = args[args.indexOf('--live') + 1].replace(/\/+$/, '');
  const paths = args.slice(args.indexOf('--live') + 2).filter((a) => !a.startsWith('--'));
  for (const r of await live(base, paths)) report.push({ route: base, ...r, ...applyExceptions('*', r.id.replace(/:.*$/, '').replace(/^live\.\/[^:]*/, 'live'), r.status, r.msg) });
} else {
  const contentPages = pages.filter((p) => !p.is404);
  for (const c of CHECKS) {
    const targets = c.scope === 'site' ? [contentPages[0]] : contentPages;
    for (const p of targets) {
      const r = c.run(p);
      const status = r === true ? 'pass' : typeof r === 'string' ? c.level : r.level;
      const msg = r === true ? '' : typeof r === 'string' ? r : r.msg;
      report.push({ route: c.scope === 'site' ? '(site)' : p.route, id: c.id, name: c.name, ...applyExceptions(p.route, c.id, status, msg) });
    }
  }
}

const count = (s) => report.filter((r) => r.status === s).length;
if (flag('--json')) console.log(JSON.stringify({ checks: CHECKS.length, pages: pages.filter((p) => !p.is404).length, production, report }, null, 2));
else {
  for (const r of report.filter((x) => x.status === 'fail' || x.status === 'warn').sort((a, b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id))) {
    console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id.padEnd(34)} ${r.route.padEnd(48)} ${r.msg}`);
  }
  // Accepted results: one line per check, with its reason, instead of one per page.
  for (const [id, rows] of Map.groupBy(report.filter((x) => x.status === 'accepted'), (x) => x.id)) {
    console.log(`ACCEPTED ${id.padEnd(34)} ${String(rows.length).padStart(3)} page(s): ${config.exceptions.find((e) => e.check === id)?.reason ?? ''}`);
  }
}
const failed = count('fail') + (flag('--strict') ? count('warn') : 0);
const label = flag('--live') ? 'live checks' : `${CHECKS.length} checks × ${pages.filter((p) => !p.is404).length} pages (${production ? 'production' : 'preview'} build)`;
console.log(`seo-checks: ${failed ? 'FAIL' : 'OK'} (${label}: ${count('pass')} pass, ${count('warn')} warn, ${count('accepted')} accepted, ${count('fail')} fail)`);
// exitCode, not process.exit(): on Linux, stdout to a pipe is asynchronous, and exiting at once cuts off a long
// report (CI saw the --json output end at ~146 KB). Node exits by itself once the output has flushed.
process.exitCode = failed ? 1 : 0;
