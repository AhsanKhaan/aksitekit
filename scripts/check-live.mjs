// After a deploy: checks the live site as Google and a visitor see it (docs/TODO-step-c.md §3). Read-only: GET
// requests to the site, and DNS questions to Cloudflare's public DNS-over-HTTPS resolver. Exits 1 on any failure.
//
//   node scripts/check-live.mjs https://example.com [--pages <project>.pages.dev] [--no-www]
//   node scripts/check-live.mjs http://localhost:4321 --local [--site https://example.com]
//
// --pages <host>  also check the pages.dev copy is noindex and has no HSTS (LIVE_PAGES_HOST works too)
// --no-www        skip the www → apex redirect check (for a site with no www record)
// --local         a local server (scripts/serve-out.mjs): skip HTTPS, HSTS, DNS and CDN checks
// --site <origin> the site's own address, for canonical checks on a local production build
import { isMain, readConfig } from './lib/site.mjs';
import { AI_SEARCH_BOTS, SEARCH_BOTS, blocksSite, robotsGroups } from './lib/public-files.mjs';

const UA = 'aksitekit-check-live/1 (read-only post-deploy check)';
// Cloudflare issues edge certificates from these CAs (Cloudflare SSL docs, "Certificate authorities", 2026-10-24 [M]).
export const CLOUDFLARE_CAS = ['letsencrypt.org', 'pki.goog', 'ssl.com', 'sectigo.com', 'digicert.com', 'comodoca.com'];
const INJECTED = [
  [/cloudflareinsights\.com|beacon\.min\.js/, 'Web Analytics auto-inject is off (our CSP would block it)'],
  [/rocket-loader|data-cf-settings/, 'Rocket Loader is off (it breaks hydration)'],
  [/email-decode\.min\.js|__cf_email__/, 'Email Address Obfuscation is off'],
  [/zaraz/i, 'Zaraz is off'],
  [/cdn-cgi\/challenge-platform|__CF\$cv\$params/, 'Bot Fight Mode is off (no injected bot script or cookies)'],
];

/** One HSTS value, with max-age, and never preload. */
export function hstsProblems(value) {
  if (!value) return ['no Strict-Transport-Security header on the real domain'];
  const p = [];
  if (value.includes(',')) p.push(`two HSTS values ("${value}"): turn off the dashboard's HSTS and keep the _headers one`);
  if (!/max-age=\d+/.test(value)) p.push(`HSTS has no max-age ("${value}")`);
  if (/preload/i.test(value)) p.push('HSTS has preload: never preload (HANDBOOK §9)');
  return p;
}

/** CAA issuers from a DoH answer; with a Cloudflare target, only Cloudflare's CAs and at least Let's Encrypt and Google. */
export function caaProblems(records, target) {
  const issuers = records.filter((d) => /^\d+ issue(?:wild)? /.test(d)).map((d) => (d.match(/"([^";]*)/)?.[1] ?? '').trim()).filter(Boolean);
  if (!issuers.length) return ['no CAA record: any CA could issue a certificate for the domain'];
  if (!String(target).startsWith('cloudflare')) return [];
  const extra = issuers.filter((ca) => !CLOUDFLARE_CAS.includes(ca));
  const p = [];
  if (extra.length) p.push(`CAA allows ${[...new Set(extra)].join(', ')}, which Cloudflare doesn't use`);
  for (const ca of ['letsencrypt.org', 'pki.goog']) if (!issuers.includes(ca)) p.push(`CAA doesn't allow ${ca}, so Cloudflare can't renew its certificates`);
  return p;
}

/** DNSSEC: the resolver validated the answer (AD flag) and answered NOERROR. */
export const dnssecProblems = (answer) => (answer?.Status === 0 && answer?.AD === true ? [] : [`DNSSEC doesn't validate (Status ${answer?.Status}, AD ${answer?.AD})`]);

/** Network Error Logging: Cloudflare adds it; a Response Header Transform Rule removes it. */
export const nelProblems = (headers) => (headers.nel || headers['report-to'] ? ['NEL / Report-To headers are sent (add the Transform Rule that removes them)'] : []);

/** robots.txt on the live site lets search (and, with bots.aiSearch "allow", AI search) in and points to the sitemap. */
export function robotsProblems(text, site, bots = {}) {
  const p = [];
  const groups = robotsGroups(text);
  const shut = [...SEARCH_BOTS, '*', ...(bots.aiSearch === 'allow' ? AI_SEARCH_BOTS : [])].filter((ua) => blocksSite(groups, ua));
  if (shut.length) p.push(`robots.txt shuts out ${shut.join(', ')}`);
  if (!text.includes(`Sitemap: ${site}/sitemap.xml`)) p.push(`robots.txt doesn't point to ${site}/sitemap.xml`);
  if (/Content-Signal|Cloudflare Managed/i.test(text)) p.push('robots.txt is Cloudflare\'s managed file, not ours (turn off managed robots.txt)');
  return p;
}

async function get(url, init = {}) {
  const res = await fetch(url, { redirect: 'manual', ...init, headers: { 'user-agent': UA, ...(init.headers ?? {}) } });
  const type = res.headers.get('content-type') ?? '';
  return { res, text: /text|xml|json|javascript/.test(type) ? await res.text() : (await res.arrayBuffer(), '') };
}
const header = (r, name) => r.res.headers.get(name) ?? '';
const metaOf = (html, name) => html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1] ?? '';
const canonicalOf = (html) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? '';

export async function run(args, env = process.env) {
  const flag = (n) => args.includes(n);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const base = (args.find((a, i) => /^https?:\/\//.test(a) && args[i - 1] !== '--site') ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('usage: node scripts/check-live.mjs <https://site> [--pages <project>.pages.dev] [--no-www] [--local [--site <origin>]]');
  const cfg = readConfig();
  const local = flag('--local');
  const site = (opt('--site') ?? base).replace(/\/+$/, '');
  const seo = !local || flag('--site');
  const failures = [];
  const notes = [];
  const check = (ok, what, detail = []) => {
    if (ok) console.log(`  ok    ${what}`);
    else {
      failures.push(what);
      console.log(`  FAIL  ${what}${detail.length ? `\n        ${detail.join('\n        ')}` : ''}`);
    }
  };
  console.log(`check-live: ${base}${local ? ' (local)' : ''}`);

  // 1. Home: 200, security headers, indexable and self-canonical, HTML as built (nothing injected by the CDN).
  const home = await get(`${base}/`);
  check(home.res.status === 200, `home is 200 (got ${home.res.status})`);
  const cspValue = header(home, 'content-security-policy');
  check(cspValue.includes("default-src 'self'") && cspValue.includes("frame-ancestors 'none'"), 'Content-Security-Policy from _headers');
  check(header(home, 'x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
  if (!local) {
    check(base.startsWith('https://'), 'served over HTTPS');
    const h = hstsProblems(header(home, 'strict-transport-security'));
    check(!h.length, 'one HSTS value with max-age, no preload', h);
    check(!/noindex/i.test(header(home, 'x-robots-tag')), 'no X-Robots-Tag noindex on the real domain');
    const n = nelProblems(Object.fromEntries(home.res.headers));
    check(!n.length, 'no Network Error Logging headers', n);
  }
  if (seo) {
    check(!/noindex/i.test(metaOf(home.text, 'robots')), `home is indexable (meta robots "${metaOf(home.text, 'robots')}")`);
    check(canonicalOf(home.text) === `${site}/`, `home canonical is ${site}/ (got "${canonicalOf(home.text)}")`);
  }
  const asBrowser = await get(`${base}/`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', accept: 'text/html' } });
  for (const [re, what] of INJECTED) check(!re.test(home.text) && !re.test(asBrowser.text), what);
  const adsOn = cfg.monetization?.adsense?.enabled === true;
  if (!adsOn) check(!/adsbygoogle|googlesyndication\.com|doubleclick\.net/.test(home.text), 'no ad code while AdSense is off');

  // 2. robots.txt and the sitemap.
  const robots = await get(`${base}/robots.txt`);
  check(robots.res.status === 200, 'robots.txt is 200');
  if (seo) {
    const r = robotsProblems(robots.text, site, cfg.bots);
    check(!r.length, 'robots.txt follows the bot policy and points to the sitemap', r);
  }
  const sitemap = await get(`${base}/sitemap.xml`);
  check(sitemap.res.status === 200, 'sitemap.xml is 200');
  const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check(locs.length > 0, `sitemap lists ${locs.length} page(s)`);
  if (seo) check(locs.every((l) => l.startsWith(`${site}/`)), `every sitemap URL is on ${site}`);

  // 3. Every sitemap page: 200, self-canonical, indexable.
  const bad = [];
  for (const loc of locs) {
    const path = loc.replace(/^https?:\/\/[^/]+/, '');
    const p = await get(`${base}${path}`);
    const why = [];
    if (p.res.status !== 200) why.push(`status ${p.res.status}`);
    if (seo && canonicalOf(p.text) !== `${site}${path}`) why.push(`canonical ${canonicalOf(p.text) || 'missing'}`);
    if (seo && /noindex/i.test(metaOf(p.text, 'robots'))) why.push('noindex');
    if (why.length) bad.push(`${path}: ${why.join(', ')}`);
  }
  check(!bad.length, `every sitemap page is 200${seo ? ', self-canonical and indexable' : ''} (${locs.length - bad.length}/${locs.length})`, bad);

  // 4. Addresses: unknown pages are real 404s; a no-slash address redirects once to the slash form; www → apex.
  const missing = await get(`${base}/no-such-page-${Date.now()}/`);
  check(missing.res.status === 404, `an unknown address is a 404 (got ${missing.res.status})`);
  const inner = locs.map((l) => l.replace(/^https?:\/\/[^/]+/, '')).find((p) => p !== '/');
  if (inner) {
    const noSlash = inner.replace(/\/$/, '');
    const r = await get(`${base}${noSlash}`);
    const to = header(r, 'location').replace(base, '');
    check([301, 308].includes(r.res.status) && to === `${noSlash}/`, `${noSlash} redirects to ${noSlash}/ in one step (${r.res.status} → ${to || 'none'})`);
  }
  if (!local && !flag('--no-www')) {
    const host = new URL(base).host;
    const w = await get(`https://www.${host}/?check=1`).catch((e) => ({ res: { status: 0, headers: new Headers() }, text: '', error: e }));
    const to = w.res.headers.get('location') ?? '';
    check([301, 308].includes(w.res.status) && to === `${base}/?check=1`, `www.${host} redirects to ${base} in one step, keeping the query (${w.res.status} → ${to || 'none'})`);
  }

  // 5. Files: favicon, security.txt, no ads.txt before approval, hashed assets cached a year.
  const fav = await get(`${base}/favicon.ico`);
  check(fav.res.status === 200 && /icon/.test(header(fav, 'content-type')), `/favicon.ico is served (${fav.res.status} ${header(fav, 'content-type')})`);
  check((await get(`${base}/.well-known/security.txt`)).res.status === 200, '/.well-known/security.txt is served');
  if (!adsOn) check((await get(`${base}/ads.txt`)).res.status === 404, 'no ads.txt while AdSense is off');
  const asset = home.text.match(/\/_next\/static\/[^"']+\.js/)?.[0];
  if (asset) {
    const a = await get(`${base}${asset}`);
    const cc = header(a, 'cache-control');
    check(a.res.status === 200 && /max-age=31536000/.test(cc) && /immutable/.test(cc), `hashed assets are cached a year, immutable ("${cc}")`);
  } else notes.push('no /_next/static script on the home page (another technology): hashed-asset caching not checked');

  // 6. DNS through DNS-over-HTTPS: DNSSEC validates; CAA allows only the host's CAs.
  if (!local) {
    const name = new URL(base).hostname;
    const doh = async (type) => (await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } })).json();
    const d = dnssecProblems(await doh('A'));
    check(!d.length, 'DNSSEC validates', d);
    const caa = ((await doh('CAA')).Answer ?? []).filter((r) => r.type === 257).map((r) => r.data);
    const c = caaProblems(caa, cfg.hosting?.target);
    check(!c.length, `CAA limits certificate issuers (${caa.length} record(s))`, c);
  }

  // 7. The pages.dev copy stays out of search.
  const pagesHost = opt('--pages') ?? env.LIVE_PAGES_HOST;
  if (pagesHost && !local) {
    const p = await get(`https://${pagesHost}/`);
    check(/noindex/i.test(header(p, 'x-robots-tag')), `${pagesHost} sends X-Robots-Tag: noindex`);
    check(!header(p, 'strict-transport-security'), `${pagesHost} has no HSTS`);
  }

  for (const n of notes) console.log(`  note  ${n}`);
  console.log(failures.length ? `check-live: FAIL, ${failures.length} failure(s)` : 'check-live: OK');
  return failures.length;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).then((n) => { process.exitCode = n ? 1 : 0; }, (e) => { console.error(`check-live: ${e.message}`); process.exitCode = 1; });
}
