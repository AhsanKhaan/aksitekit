// The AdSense gate (`npm run gate:adsense`, docs/TODO-step-c.md §3), over the built site in build.outputDir:
//   1. the trust pages (About, Contact, Privacy, Terms, Editorial policy) and an author page exist, linked from every page;
//   2. no ad code and no ads.txt until the owner switches AdSense on after approval (CLAUDE.md "Never");
//      once on: the publisher ID, the exact ads.txt line, a Google-certified consent platform (CMP) for the EEA, the UK
//      and Switzerland, and a privacy page that names advertising cookies;
//   3. no placeholder text and no template example page;
//   4. content floors per page type (words in <main>);
//   5. policy risk: restricted content and click-baiting fail; YMYL topics are listed for the owner.
// A pass is necessary, not sufficient: the owner still confirms identity and Search Console history
// (.claude/agents/adsense-gatekeeper.md). It never adds ad code.
//
//   node scripts/adsense-gate.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtPages, internalLinks, isHeld, isMain, mainOf, outputDir, readConfig, siteUrl, slashed, textOf } from './lib/site.mjs';
import { AD_PATTERNS, readOutput } from './check-out.mjs';
import { AUTHOR_PREFIX, FLOORS, INVALID_TRAFFIC, PLACEHOLDER_TEXT, POLICY_RESTRICTED, TRUST_PAGES, YMYL, pageKind } from './lib/content-rules.mjs';

const KEYWORD_MAP = process.env.KEYWORD_MAP || 'research/out/keyword-map.json';
const ADS_TXT_LINE = (pub) => `google.com, ${pub}, DIRECT, f08c47fec0942fa0`;

export function keywordTypes(file = KEYWORD_MAP) {
  if (!existsSync(file)) return new Map();
  const map = JSON.parse(readFileSync(file, 'utf8'));
  return new Map((Array.isArray(map) ? map : map.pages ?? []).map((r) => [r.url, r.type]));
}

/** { failures, notes } for a built site. */
export function evaluate({ pages, files, cfg, origin, types = new Map() }) {
  const failures = [];
  const notes = [];
  const live = pages.filter((p) => !p.notFound);
  const routes = new Set(live.map((p) => p.route));
  const ads = cfg.monetization?.adsense ?? {};
  const enabled = ads.enabled === true;
  const exceptions = ads.policyExceptions ?? [];

  // 1. Trust pages and an author page, each linked from every page.
  for (const t of TRUST_PAGES) if (!routes.has(t)) failures.push(`required page ${t} is missing`);
  const authors = [...routes].filter((r) => r.startsWith(AUTHOR_PREFIX) && r !== AUTHOR_PREFIX);
  if (!authors.length) failures.push(`no author page under ${AUTHOR_PREFIX} (a real person who stands behind the content)`);
  for (const p of live) {
    const links = new Set(internalLinks(p.html, origin).map(slashed));
    const missing = TRUST_PAGES.filter((t) => !links.has(t) && t !== p.route);
    if (missing.length) failures.push(`${p.route}: no link to ${missing.join(', ')} (put the trust pages in the footer)`);
  }

  // 2. Ads: none before approval; the full set once switched on.
  const adsTxt = files.get('ads.txt');
  const adCode = [...files].filter(([n, t]) => /\.(?:html|js)$/.test(n) && AD_PATTERNS.some((re) => re.test(t))).map(([n]) => n);
  if (!enabled) {
    if (adsTxt !== undefined) failures.push('ads.txt exists before AdSense is switched on (monetization.adsense.enabled)');
    if (adCode.length) failures.push(`ad code before AdSense is switched on: ${adCode.slice(0, 5).join(', ')}`);
    notes.push('AdSense is off. Before switching it on: approval in the owner\'s AdSense account, then a Google-certified CMP for EEA, UK and Swiss visitors (monetization.adsense.cmp; Google\'s own Privacy & messaging is free)');
  } else {
    const pub = String(ads.publisherId ?? '');
    if (!/^pub-\d{16}$/.test(pub)) failures.push('monetization.adsense.publisherId must be "pub-" and 16 digits');
    else if (!String(adsTxt ?? '').split(/\r?\n/).map((l) => l.trim()).includes(ADS_TXT_LINE(pub))) failures.push(`ads.txt must contain "${ADS_TXT_LINE(pub)}"`);
    if (!String(ads.cmp ?? '').trim()) failures.push('monetization.adsense.cmp is empty: ads need a Google-certified consent platform for the EEA, the UK and Switzerland (owner picks)');
    const privacy = live.find((p) => p.route === '/privacy/');
    if (privacy && !/advertis/i.test(textOf(mainOf(privacy.html)))) failures.push('/privacy/ doesn\'t describe advertising cookies, but ads are on');
    const headers = files.get('_headers') ?? '';
    if (!/googlesyndication\.com/.test(headers)) failures.push('_headers: the CSP doesn\'t allow the AdSense hosts, so ads would be blocked');
  }

  // 3. No placeholders, no example pages.
  for (const p of live) {
    const text = textOf(p.html.replace(/<head\b[\s\S]*?<\/head>/i, ''));
    const m = text.match(PLACEHOLDER_TEXT);
    if (m) failures.push(`${p.route}: placeholder text "${m[0]}"`);
    if (/\bdata-example-page\b/.test(p.html)) failures.push(`${p.route}: a template example page; AdSense reviews real content only`);
  }

  // 4. Content floors (words in <main>).
  for (const p of live.filter((x) => !isHeld(x.html))) {
    const kind = pageKind(p.route, types.get(p.route));
    const words = textOf(mainOf(p.html)).split(/\s+/).filter(Boolean).length;
    if (words < FLOORS[kind]) failures.push(`${p.route}: ${words} words in <main>, under the ${kind} floor of ${FLOORS[kind]} (write more that helps the reader; never pad)`);
  }

  // 5. Policy risk.
  for (const p of live) {
    const text = textOf(mainOf(p.html));
    for (const [topic, re] of POLICY_RESTRICTED) {
      const m = text.match(re);
      if (m && !exceptions.some((e) => e.route === p.route && String(e.term).toLowerCase() === m[0].toLowerCase() && e.reason && e.reviewed)) {
        failures.push(`${p.route}: "${m[0]}" (${topic}) is restricted or prohibited for AdSense; remove it, or the owner records a reviewed exception`);
      }
    }
    for (const re of INVALID_TRAFFIC) {
      const m = text.match(re);
      if (m) failures.push(`${p.route}: "${m[0]}" asks visitors to click ads (invalid traffic)`);
    }
    const y = text.match(YMYL);
    if (y) notes.push(`${p.route}: a your-money-or-your-life topic ("${y[0]}"): the owner decides whether it ships, with sources and a disclaimer`);
  }
  return { failures, notes };
}

if (isMain(import.meta.url)) {
  try {
    const cfg = readConfig();
    const out = outputDir(cfg);
    if (!existsSync(join(out, 'index.html'))) throw new Error(`${out}/index.html not found: run npm run build first`);
    const files = readOutput(out);
    const { failures, notes } = evaluate({ pages: builtPages(out), files, cfg, origin: siteUrl(cfg).url, types: keywordTypes() });
    for (const n of notes) console.log(`gate:adsense: note: ${n}`);
    if (failures.length) {
      console.error(`gate:adsense: NO-GO, ${failures.length} problem(s)\n - ${failures.slice(0, 80).join('\n - ')}`);
      process.exitCode = 1;
    } else console.log('gate:adsense: PASS (necessary, not sufficient: the owner confirms identity and Search Console history)');
  } catch (e) {
    console.error(`gate:adsense: ${e.message}`);
    process.exitCode = 1;
  }
}
