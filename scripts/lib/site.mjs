// Shared by the Step C gate scripts (docs/TODO-step-c.md): the project config, the build output folder, the site's
// address and a few HTML readers for the built pages. No dependencies, so any technology's output can be checked.
//
// Every gate reads the site from factory.config.json → build.outputDir, never a hard-coded folder.
// FACTORY_CONFIG=<path> reads another config file, and SITE_OUT=<dir> another output folder (tests).
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** RFC 2606 reserves example.com: the template builds against it until /start sets project.domain. */
export const TEMPLATE_URL = 'https://example.com';
export const TEMPLATE_NAME = 'Example Site';
const FOLDER = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
export const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/;

export function readConfig(file = process.env.FACTORY_CONFIG || 'factory.config.json') {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file} doesn't parse: ${e.message}`);
  }
}

const folder = (value, key) => {
  const v = String(value ?? '');
  if (!FOLDER.test(v) || v.split('/').includes('..')) throw new Error(`factory.config.json → ${key} must be a relative folder inside the repo (got "${v}")`);
  return v;
};

/** Environment variables as the gates read them (process.env, or a planted object in the tests). */
/** @typedef {Record<string, string | undefined>} Env */

/** The folder the chosen technology builds into (build.outputDir). @param {any} cfg @param {Env} [env] */
export const outputDir = (cfg, env = process.env) => env.SITE_OUT || folder(cfg.build?.outputDir || 'out', 'build.outputDir');
/** The folder the technology copies into the output as is (Next.js, Astro and Vite: public; Hugo: static). */
export const publicDir = (cfg) => folder(cfg.build?.publicDir || 'public', 'build.publicDir');

export const domainOf = (cfg) => String(cfg.project?.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
export const siteName = (cfg) => String(cfg.project?.brand || cfg.project?.name || '').trim() || TEMPLATE_NAME;

/**
 * Production builds set SITE_ENV=production (CI); a Cloudflare Pages build of the production branch counts too.
 * @param {any} cfg
 * @param {Env} [env]
 */
export function buildContext(cfg, env = process.env) {
  if (env.SITE_ENV === 'production') return 'production';
  if (env.CF_PAGES === '1') return env.CF_PAGES_BRANCH === (cfg.hosting?.productionBranch || 'main') ? 'production' : 'preview';
  if (env.SITE_ENV === 'preview') return 'preview';
  return 'local';
}

/** Indexable builds: technology-neutral SITE_INDEXABLE, or the Next.js name (.github/README.md). */
/** @param {Env} [env] */
export const indexable = (env = process.env) => (env.SITE_INDEXABLE || env.NEXT_PUBLIC_INDEXABLE) === 'true';

/**
 * The site's origin, in the same order as scripts/audits/seo-checks.mjs: SITE_URL, NEXT_PUBLIC_SITE_URL, then
 * https://project.domain. Without a domain (the template, or a copy before /start) builds use example.com; a
 * production build never does (production-gate.mjs).
 */
/** @param {any} cfg @param {Env} [env] */
export function siteUrl(cfg, env = process.env) {
  const fromEnv = env.SITE_URL || env.NEXT_PUBLIC_SITE_URL;
  const domain = domainOf(cfg);
  const url = (fromEnv || (domain ? `https://${domain}` : TEMPLATE_URL)).replace(/\/+$/, '');
  return { url, source: fromEnv ? 'env' : domain ? 'project.domain' : 'template' };
}

// ---------- the built output ----------

export const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
export const toPosix = (p) => p.split(sep).join('/');

/** "/a/b/" for out/a/b/index.html, "/404.html" for out/404.html. */
export function routeOf(out, file) {
  const r = '/' + toPosix(relative(out, file));
  return r.endsWith('/index.html') ? r.slice(0, -'index.html'.length) : r;
}

export const is404 = (route) => /(?:^|\/)(?:404|_not-found)(?:\/|\.html|$)/.test(route);

/** Every HTML page in the output, 404 pages marked. */
export function builtPages(out) {
  if (!existsSync(out)) throw new Error(`${out}/ not found: build the site first (npm run build)`);
  return walk(out)
    .filter((f) => f.endsWith('.html') && !toPosix(f).includes('/_next/'))
    .map((file) => {
      const route = routeOf(out, file);
      return { file, route, html: readFileSync(file, 'utf8'), notFound: is404(route) };
    });
}

// ---------- HTML readers (the output is generated, well-formed markup) ----------

export const decode = (s) => String(s)
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

export function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

export const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => attrs(m[0].replace(new RegExp(`^<${name}`, 'i'), '')));
export const headOf = (html) => html.slice(0, Math.max(0, html.search(/<\/head>/i)));
export const mainOf = (html) => (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ?? [, ''])[1];

/** Visible text: scripts, styles, SVG and comments removed, block ends kept as spaces. */
export function textOf(html) {
  return decode(html
    .replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export const wordsOf = (text) => String(text).match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? [];

export function meta(html, name) {
  const head = headOf(html);
  const t = tagsOf(head, 'meta').find((a) => (a.name || a.property || '').toLowerCase() === name.toLowerCase());
  return t?.content ?? '';
}

export const titleOf = (html) => textOf((headOf(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) ?? [, ''])[1]);
export const canonicalsOf = (html) => tagsOf(headOf(html), 'link').filter((a) => (a.rel || '').toLowerCase() === 'canonical').map((a) => a.href);
export const robotsOf = (html) => meta(html, 'robots').toLowerCase();
/** "noindex, follow" holds one page out of search in every build; preview builds are "noindex, nofollow" everywhere. */
export const isHeld = (html) => /noindex/.test(robotsOf(html)) && !/nofollow/.test(robotsOf(html));

/** Internal links as paths ("/a/b/"), without query or fragment. */
export function internalLinks(html, origin) {
  const out = [];
  for (const a of tagsOf(html, 'a')) {
    let href = a.href ?? '';
    if (origin && href.startsWith(origin + '/')) href = href.slice(origin.length);
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    out.push(href.split('#')[0].split('?')[0] || '/');
  }
  return out;
}

export const slashed = (p) => (p.endsWith('/') || /\.[a-z0-9]+$/i.test(p) ? p : `${p}/`);

/** Run main() only when the file is executed directly, so tests can import its functions. */
export function isMain(metaUrl) {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(metaUrl);
  } catch {
    return false;
  }
}

/** Print problems and set the exit code (exitCode, not exit(): stdout to a pipe must flush first). */
export function report(name, problems, okMessage, notes = []) {
  for (const n of notes) console.log(`${name}: note: ${n}`);
  if (problems.length) {
    console.error(`${name}: FAIL, ${problems.length} problem(s)\n - ${problems.slice(0, 80).join('\n - ')}${problems.length > 80 ? `\n - … and ${problems.length - 80} more` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: OK${okMessage ? ` (${okMessage})` : ''}`);
  }
}
