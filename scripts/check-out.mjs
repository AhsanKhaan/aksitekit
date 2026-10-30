// Post-build checks over the built site in build.outputDir, for any technology (docs/TODO-step-c.md §3). Every page:
// one title and one meta description (each unique), one H1, one self-canonical, an og:image that exists, a favicon
// link that exists; the link graph: no broken internal links, at least 3 inbound links, at most 3 clicks from home;
// the sitemap and llms.txt list exactly the published pages; the required files exist; no ad code or ads.txt while
// AdSense is off; no example page in a production build; no hidden file but .well-known/. Fails the build on any problem.
//
//   node scripts/check-out.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContext, builtPages, canonicalsOf, internalLinks, isHeld, isMain, meta, outputDir, readConfig, siteUrl, slashed, tagsOf, headOf, titleOf, walk } from './lib/site.mjs';
import { llmsLinks, sitemapLocs } from './lib/public-files.mjs';

export const REQUIRED_FILES = ['robots.txt', 'sitemap.xml', 'llms.txt', '_headers', '404.html', 'favicon.ico', '.well-known/security.txt'];
export const AD_PATTERNS = [/adsbygoogle/i, /pagead2\.googlesyndication\.com/i, /googlesyndication\.com\/pagead/i, /doubleclick\.net/i, /googleadservices\.com/i];
const MAX_LINKS = 150;

/** All problems for a built site. `files` maps a path inside the output to its text (tests pass a planted site). */
export function checkSite({ pages, files, origin, adsEnabled = false, production = false }) {
  const problems = [];
  const fileExists = (p) => files.has(p.replace(/^\//, ''));
  const html = new Map(pages.filter((p) => !p.notFound).map((p) => [p.route, p.html]));
  const exists = (path) => html.has(slashed(path)) || fileExists(path) || fileExists(`${path.replace(/\/$/, '')}/index.html`);

  for (const f of REQUIRED_FILES) if (!fileExists(f)) problems.push(`missing ${f} in the output folder`);
  if (!pages.some((p) => p.notFound)) problems.push('no 404 page');

  // 1. Head: one title, one description (unique), one H1, one self-canonical, og:image and favicon that exist.
  const seen = { title: new Map(), description: new Map() };
  for (const [route, h] of html) {
    const head = headOf(h);
    const titles = (head.match(/<title\b/gi) ?? []).length;
    const descs = tagsOf(head, 'meta').filter((a) => (a.name || '').toLowerCase() === 'description').length;
    if (titles !== 1) problems.push(`${route}: ${titles} <title> tags (need 1)`);
    if (descs !== 1) problems.push(`${route}: ${descs} meta descriptions (need 1)`);
    for (const [kind, value] of [['title', titleOf(h)], ['description', meta(h, 'description')]]) {
      if (!value) continue;
      if (seen[kind].has(value)) problems.push(`${route}: same ${kind} as ${seen[kind].get(value)}`);
      else seen[kind].set(value, route);
    }
    const h1 = (h.match(/<h1[\s>]/gi) ?? []).length;
    if (h1 !== 1) problems.push(`${route}: ${h1} <h1> tags (need 1)`);
    const canon = canonicalsOf(h);
    if (canon.length !== 1) problems.push(`${route}: ${canon.length} canonical links (need 1)`);
    else if (canon[0] !== origin + route && !isHeld(h)) problems.push(`${route}: canonical ${canon[0]} is not ${origin + route}`);
    const og = meta(h, 'og:image');
    if (!og) problems.push(`${route}: no og:image`);
    else if (!og.startsWith(origin + '/') || !/\.(?:png|jpe?g|webp)$/i.test(og) || !fileExists(og.slice(origin.length))) problems.push(`${route}: og:image ${og} is not an image file in the output`);
    const icon = tagsOf(head, 'link').find((a) => /(?:^|\s)icon(?:\s|$)/i.test(a.rel || ''));
    if (!icon) problems.push(`${route}: no <link rel="icon"> (browsers fall back to /favicon.ico)`);
    else if (!fileExists(icon.href.split('?')[0].replace(origin, ''))) problems.push(`${route}: favicon ${icon.href} is not in the output`);
    if (production && /\bdata-example-page\b/.test(h)) problems.push(`${route}: a template example page in a production build (replace or delete it)`);
  }

  // 2. Link graph: no broken links, at most MAX_LINKS per page, at least 3 inbound, at most 3 clicks from home.
  const inbound = new Map([...html.keys()].map((r) => [r, new Set()]));
  for (const [from, h] of html) {
    const links = internalLinks(h, origin);
    if (links.length > MAX_LINKS) problems.push(`${from}: ${links.length} internal links (max ${MAX_LINKS})`);
    for (const l of new Set(links)) {
      if (!exists(l)) problems.push(`${from}: broken internal link ${l}`);
      const to = slashed(l);
      if (to !== from && inbound.has(to)) inbound.get(to).add(from);
    }
  }
  for (const [route, set] of inbound) if (route !== '/' && !isHeld(html.get(route)) && set.size < 3) problems.push(`${route}: ${set.size} inbound internal link(s) from other pages (need at least 3)`);
  const depth = new Map([['/', 0]]);
  const queue = ['/'];
  while (queue.length) {
    const r = queue.shift();
    for (const l of internalLinks(html.get(r) ?? '', origin)) {
      const to = slashed(l);
      if (html.has(to) && !depth.has(to)) {
        depth.set(to, depth.get(r) + 1);
        queue.push(to);
      }
    }
  }
  if (!html.has('/')) problems.push('no home page (index.html)');
  for (const r of html.keys()) {
    if (!depth.has(r)) problems.push(`${r}: not reachable from the home page`);
    else if (depth.get(r) > 3) problems.push(`${r}: ${depth.get(r)} clicks from home (max 3)`);
  }

  // 3. The sitemap and llms.txt list exactly the published pages (held "noindex, follow" pages stay out).
  const held = new Set([...html].filter(([, h]) => isHeld(h)).map(([r]) => r));
  const published = [...html.keys()].filter((r) => !held.has(r));
  const locs = sitemapLocs(files.get('sitemap.xml') ?? '');
  for (const r of published) if (!locs.includes(origin + r)) problems.push(`${r}: not in sitemap.xml`);
  for (const l of locs) {
    if (!l.startsWith(origin + '/')) problems.push(`sitemap.xml lists ${l}, which is not on ${origin}`);
    else if (!html.has(l.slice(origin.length))) problems.push(`sitemap.xml lists ${l}, which has no page`);
    else if (held.has(l.slice(origin.length))) problems.push(`sitemap.xml lists ${l}, which is held noindex`);
  }
  const llms = files.get('llms.txt') ?? '';
  if (llms && !/^# \S/.test(llms.trimStart())) problems.push('llms.txt must start with "# <site name>"');
  for (const l of llmsLinks(llms)) {
    const r = l.startsWith(origin) ? l.slice(origin.length) : null;
    if (r === null || !html.has(r)) problems.push(`llms.txt lists ${l}, which is not a page of this site`);
    else if (held.has(r)) problems.push(`llms.txt lists ${l}, which is held noindex`);
  }

  // 4. No ad code and no ads.txt until AdSense is approved and switched on (CLAUDE.md).
  if (!adsEnabled) {
    if (fileExists('ads.txt')) problems.push('ads.txt exists, but AdSense is off (monetization.adsense.enabled)');
    for (const [name, text] of files) {
      if (!/\.(?:html|js|txt|json)$/.test(name)) continue;
      for (const re of AD_PATTERNS) if (re.test(text)) problems.push(`${name}: ad code (${re.source}) while AdSense is off`);
    }
  }

  // 5. Only site files: no hidden file or folder but .well-known/ (a .gitkeep, .DS_Store or .env would go live).
  for (const name of files.keys()) {
    if (name.split('/').some((part) => part.startsWith('.') && part !== '.well-known')) problems.push(`${name}: a hidden file in the output folder (only .well-known/ is published)`);
  }
  return { problems, stats: { pages: html.size, held: held.size, maxDepth: Math.max(0, ...depth.values()) } };
}

/** Text files of the output folder (and the names of binary ones). */
export function readOutput(out) {
  const files = new Map();
  for (const f of walk(out)) {
    const name = f.slice(out.length + 1).split('\\').join('/');
    files.set(name, /\.(?:html|js|css|txt|json|xml|map|svg|webmanifest)$|^_headers$|^_redirects$/.test(name) ? readFileSync(f, 'utf8') : '');
  }
  return files;
}

if (isMain(import.meta.url)) {
  try {
    const cfg = readConfig();
    const out = outputDir(cfg);
    if (!existsSync(join(out))) throw new Error(`${out}/ not found: run the build first`);
    const { url } = siteUrl(cfg);
    const production = buildContext(cfg) === 'production';
    const { problems, stats } = checkSite({ pages: builtPages(out), files: readOutput(out), origin: url, adsEnabled: production && cfg.monetization?.adsense?.enabled === true, production });
    if (problems.length) {
      console.error(`check-out: FAIL, ${problems.length} problem(s) in ${out}/\n - ${problems.slice(0, 80).join('\n - ')}`);
      process.exitCode = 1;
    } else {
      console.log(`check-out: OK (${stats.pages} pages in ${out}/, ${stats.held} held noindex, max depth ${stats.maxDepth}, site ${url})`);
    }
  } catch (e) {
    console.error(`check-out: ${e.message}`);
    process.exitCode = 1;
  }
}
