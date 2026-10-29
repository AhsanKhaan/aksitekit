// The generated public files (docs/TODO-step-c.md §2), as pure functions so the tests can plant failing cases:
// robots.txt from factory.config.json → bots, the _headers rules (CSP and the security headers), security.txt, and the
// sitemap and llms.txt built from the pages the build actually wrote.
import { isHeld, meta, mainOf, textOf, titleOf } from './site.mjs';

// Crawler names (Google, Microsoft, OpenAI, Anthropic, Perplexity and Common Crawl crawler docs; HANDBOOK §8).
export const SEARCH_BOTS = ['Googlebot', 'Bingbot'];
/** AdSense's crawlers ignore the "*" group, so each one gets its own. */
export const ADSENSE_BOTS = ['Mediapartners-Google', 'AdsBot-Google'];
export const AI_SEARCH_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot'];
export const AI_TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot'];
const POLICY = new Set(['allow', 'block']);

/** Bot policy problems that a production build can't ship with (an undecided "ask" included). */
export function botPolicyProblems(bots = {}) {
  const problems = [];
  for (const key of ['search', 'adsense', 'aiSearch', 'aiTraining']) {
    if (!POLICY.has(bots[key])) problems.push(`factory.config.json → bots.${key} is "${bots[key] ?? ''}"; it must be "allow" or "block" (owner decides; "ask" means not decided yet)`);
  }
  if (bots.search === 'block') problems.push('bots.search is "block": that removes the site from Google and Bing');
  return problems;
}

/**
 * One group per crawler, so every robots.txt parser reads the same policy. Preview builds use the same policy: they
 * stay out of search through noindex (meta robots and X-Robots-Tag), which a crawler only sees if it may fetch the page.
 */
export function robotsTxt({ name, bots = {}, siteUrl }) {
  const lines = [`# robots.txt for ${name}: written by scripts/gen-public-files.mjs from factory.config.json → bots.`, ''];
  const group = (comment, list, policy) => {
    lines.push(`# ${comment}`);
    for (const ua of list) lines.push(`User-agent: ${ua}`, policy === 'block' ? 'Disallow: /' : 'Allow: /', '');
  };
  group(`Search engines (bots.search: ${bots.search ?? 'allow'})`, SEARCH_BOTS, bots.search === 'block' ? 'block' : 'allow');
  group(`AdSense crawlers ignore "*", so they get their own groups (bots.adsense: ${bots.adsense ?? 'allow'})`, ADSENSE_BOTS, bots.adsense === 'block' ? 'block' : 'allow');
  group(`AI search and answer engines (bots.aiSearch: ${bots.aiSearch ?? 'allow'})`, AI_SEARCH_BOTS, bots.aiSearch === 'block' ? 'block' : 'allow');
  if (POLICY.has(bots.aiTraining)) group(`AI training crawlers (bots.aiTraining: ${bots.aiTraining}; enforce with Cloudflare AI Crawl Control)`, AI_TRAINING_BOTS, bots.aiTraining);
  else lines.push(`# AI training crawlers: bots.aiTraining is "${bots.aiTraining ?? ''}" (not decided), so they follow "*". A production build fails until the owner decides.`, '');
  lines.push('User-agent: *', 'Allow: /', '', `Sitemap: ${siteUrl}/sitemap.xml`, '');
  return lines.join('\n');
}

/**
 * robots.txt as groups { agents, rules: [{ allow, path }] } (the parser gate.mjs's ai-search check uses).
 * @param {string} text
 */
export function robotsGroups(text) {
  /** @type {{ agents: string[], rules: { allow: boolean, path: string }[] }[]} */
  const groups = [];
  /** @type {{ agents: string[], rules: { allow: boolean, path: string }[] } | null} */
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(m[2].trim().toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) current.rules.push({ allow: key === 'allow', path: m[2].trim() });
  }
  return groups;
}

/** A crawler obeys the group that names it, else "*"; it's shut out when that group disallows "/" and allows nothing. */
export function blocksSite(groups, ua) {
  const name = ua.toLowerCase();
  const group = groups.find((g) => g.agents.includes(name)) || groups.find((g) => g.agents.includes('*'));
  if (!group) return false;
  return group.rules.some((r) => !r.allow && r.path === '/') && !group.rules.some((r) => r.allow && r.path.startsWith('/'));
}

// Google tag (GA4) and AdSense hosts, from Google's CSP guides for each product. Added only when the build uses them.
const GA_CSP = {
  script: ['https://www.googletagmanager.com'],
  img: ['https://www.googletagmanager.com', 'https://*.google-analytics.com'],
  connect: ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'],
};
const ADS_CSP = {
  script: ['https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com', 'https://*.adtrafficquality.google', 'https://fundingchoicesmessages.google.com'],
  img: ['https://*.googlesyndication.com', 'https://*.g.doubleclick.net', 'https://*.google.com', 'https://*.adtrafficquality.google'],
  connect: ['https://*.googlesyndication.com', 'https://*.g.doubleclick.net', 'https://*.adtrafficquality.google', 'https://fundingchoicesmessages.google.com'],
  frame: ['https://*.googlesyndication.com', 'https://*.g.doubleclick.net', 'https://*.adtrafficquality.google', 'https://www.google.com', 'https://fundingchoicesmessages.google.com'],
};

/** The Content-Security-Policy: same-origin only, plus the hosts of what this build loads. */
export function csp({ analytics = false, ads = false } = {}) {
  const extra = (k) => [...(analytics ? GA_CSP[k] ?? [] : []), ...(ads ? ADS_CSP[k] ?? [] : [])];
  const src = (k, base) => [base, ...extra(k)].join(' ');
  return [
    "default-src 'self'",
    // Static export: Next.js writes inline bootstrap scripts and no nonce is possible, so 'unsafe-inline' (never 'unsafe-eval').
    `script-src ${src('script', "'self' 'unsafe-inline'")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${src('img', "'self' data:")}`,
    "font-src 'self'",
    `connect-src ${src('connect', "'self'")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `frame-src ${ads ? ADS_CSP.frame.join(' ') : "'none'"}`,
    "worker-src 'none'",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** HSTS on the real domain only, ramped by the owner, never "preload" (HANDBOOK §9). */
export function hstsValue(value) {
  const v = String(value || 'max-age=86400').trim();
  if (!/^max-age=\d+(?:; ?includeSubDomains)?$/.test(v)) throw new Error(`hosting.hsts "${v}" must be "max-age=<seconds>" with an optional "; includeSubDomains" (never preload)`);
  return v;
}

/**
 * public/_headers in the Cloudflare format (Pages and Workers static assets): the security headers on every path,
 * long caching for hashed assets, noindex on preview hosts and on every non-indexable build, HSTS on the real domain.
 * @param {{ siteUrl: string, target?: string, framework?: string, indexable?: boolean, analytics?: boolean, ads?: boolean, hsts?: string }} options
 */
export function headersFile({ siteUrl, target = 'cloudflare-pages', framework = 'nextjs', indexable = false, analytics = false, ads = false, hsts }) {
  const host = new URL(siteUrl).host;
  const lines = [
    '# Written by scripts/gen-public-files.mjs (docs/TODO-step-c.md §2). Edit the generator, not this file.',
    '/*',
    `  Content-Security-Policy: ${csp({ analytics, ads })}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  X-Frame-Options: DENY',
  ];
  if (!indexable) lines.push('  X-Robots-Tag: noindex, nofollow');
  lines.push('');
  if (framework === 'nextjs') lines.push('/_next/static/*', '  Cache-Control: public, max-age=31536000, immutable', '');
  // A placeholder matches one host label, so the Pages project host and each deployment's <hash>.<project> host need a
  // rule each. Workers version previews (<version>-<worker>.<account>.workers.dev) can't be matched by one placeholder
  // label [U]; the meta robots noindex of every non-production build covers them.
  const previews = target === 'cloudflare-workers' ? [':project.:account.workers.dev'] : [':project.pages.dev', ':version.:project.pages.dev'];
  lines.push('# Preview and project hosts are never indexed.');
  for (const p of previews) lines.push(`https://${p}/*`, '  X-Robots-Tag: noindex', '');
  lines.push('# HSTS on the real domain only (never on previews, never preload). Ramp hosting.hsts after a clean week.');
  lines.push(`https://${host}/*`, `  Strict-Transport-Security: ${hstsValue(hsts)}`, '');
  return lines.join('\n');
}

/** RFC 9116; Expires stays under a year. */
export function securityTxt({ siteUrl, email, now = new Date(), locale = 'en' }) {
  const expires = new Date(now.getTime() + 360 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  return [`Contact: mailto:${email}`, `Expires: ${expires}`, `Preferred-Languages: ${locale}`, `Canonical: ${siteUrl}/.well-known/security.txt`, ''].join('\n');
}

// ---------- from the built pages ----------

/** dateModified of the page itself in its JSON-LD (YYYY-MM-DD), if any. */
export function modifiedOf(html) {
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    const d = m[1].match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
    if (d) return d[1];
  }
  return '';
}

/** The pages that belong in the sitemap and llms.txt: built, not the 404 page, not held with "noindex, follow". */
export function publishedPages(pages, siteUrl) {
  return pages
    .filter((p) => !p.notFound && !isHeld(p.html))
    .map((p) => ({
      route: p.route,
      url: siteUrl + p.route,
      title: titleOf(p.html),
      h1: textOf((p.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? [, ''])[1]),
      description: meta(p.html, 'description'),
      modified: modifiedOf(p.html),
      trust: /\bdata-trust-page\b/.test(p.html),
      words: textOf(mainOf(p.html)).split(' ').length,
    }))
    .sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : a.route.localeCompare(b.route)));
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sitemapXml(published) {
  const rows = published.map((p) => `  <url><loc>${xml(p.url)}</loc>${p.modified ? `<lastmod>${p.modified}</lastmod>` : ''}</url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...rows, '</urlset>', ''].join('\n');
}

const md = (s) => String(s).replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();

/** llmstxt.org format: "# name", a "> summary", then each category's pages and the trust pages under "## Optional". */
export function llmsTxt({ name, published }) {
  const home = published.find((p) => p.route === '/');
  const lines = [`# ${md(name)}`, ''];
  if (home?.description) lines.push(`> ${md(home.description)}`, '');
  const link = (p) => `- [${md(p.h1 || p.title)}](${p.url})${p.description ? `: ${md(p.description)}` : ''}`;
  const content = published.filter((p) => p.route !== '/' && !p.trust);
  const categories = [...new Set(content.map((p) => p.route.split('/')[1]))];
  for (const c of categories) {
    const index = content.find((p) => p.route === `/${c}/`);
    lines.push(`## ${md(index?.h1 || c.replace(/-/g, ' '))}`, '');
    for (const p of content.filter((x) => x.route.split('/')[1] === c)) lines.push(link(p));
    lines.push('');
  }
  const trust = published.filter((p) => p.trust);
  if (trust.length) {
    lines.push('## Optional', '');
    for (const p of trust) lines.push(link(p));
    lines.push('');
  }
  return lines.join('\n');
}

/** Links in an llms.txt file, as absolute URLs. */
export const llmsLinks = (text) => [...String(text).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
/** <loc> values in a sitemap. */
export const sitemapLocs = (text) => [...String(text).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
