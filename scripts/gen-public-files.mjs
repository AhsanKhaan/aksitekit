// The public files that depend on the project and the build (docs/TODO-step-c.md §2), for any technology.
//
//   node scripts/gen-public-files.mjs                before the framework (`npm run dev`, `npm run build`): writes
//                                                    robots.txt, _headers and .well-known/security.txt into
//                                                    build.publicDir (default public/, copied as is by the framework)
//   node scripts/gen-public-files.mjs --after-build  after it: writes sitemap.xml and llms.txt into build.outputDir
//                                                    from the pages the build wrote, and copies the files above in
//                                                    if the technology didn't
//
// robots.txt follows factory.config.json → bots; llms.txt starts with "# <site name>" (the ai-search gate checks
// both). Generated files are git-ignored: edit this script or the config, never the output.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { builtPages, domainOf, indexable, isMain, outputDir, publicDir, readConfig, siteName, siteUrl } from './lib/site.mjs';
import { headersFile, llmsTxt, publishedPages, robotsTxt, securityTxt, sitemapXml } from './lib/public-files.mjs';

const SITE_CONTENT = process.env.SITE_CONTENT || 'content/site.json';
const BEFORE = ['robots.txt', '_headers', '.well-known/security.txt'];

/** The build's analytics and ads switches, as the starter applies them (lib/site.ts). @param {any} cfg @param {import('./lib/site.mjs').Env} [env] */
export function buildFeatures(cfg, env = process.env) {
  const production = indexable(env) && (env.SITE_ENV === 'production' || (env.CF_PAGES === '1' && env.CF_PAGES_BRANCH === (cfg.hosting?.productionBranch || 'main')));
  return {
    analytics: production && /^G-[A-Z0-9]{4,}$/.test(String(cfg.analytics?.ga4MeasurementId ?? '')),
    ads: production && cfg.monetization?.adsense?.enabled === true,
  };
}

/** @param {any} cfg @param {import('./lib/site.mjs').Env} [env] @param {Date} [now] */
export function beforeBuild(cfg, env = process.env, now = new Date()) {
  const { url } = siteUrl(cfg, env);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search) throw new Error(`the site URL must be an https origin, got "${url}"`);
  const site = existsSync(SITE_CONTENT) ? JSON.parse(readFileSync(SITE_CONTENT, 'utf8')) : {};
  const email = String(site.contact?.email || `contact@${domainOf(cfg) || parsed.host}`);
  const features = buildFeatures(cfg, env);
  return {
    'robots.txt': robotsTxt({ name: siteName(cfg), bots: cfg.bots, siteUrl: url }),
    _headers: headersFile({ siteUrl: url, target: cfg.hosting?.target, framework: cfg.build?.framework, indexable: indexable(env), hsts: cfg.hosting?.hsts, ...features }),
    '.well-known/security.txt': securityTxt({ siteUrl: url, email, now, locale: cfg.project?.locale || 'en' }),
  };
}

/** @param {any} cfg @param {import('./lib/site.mjs').Env} [env] */
export function afterBuild(cfg, env = process.env) {
  const out = outputDir(cfg, env);
  const { url } = siteUrl(cfg, env);
  const published = publishedPages(builtPages(out), url);
  if (!published.some((p) => p.route === '/')) throw new Error(`${out}/index.html is missing: the build wrote no home page`);
  return { out, files: { 'sitemap.xml': sitemapXml(published), 'llms.txt': llmsTxt({ name: siteName(cfg), published }) }, count: published.length };
}

const write = (dir, name, text) => {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), text);
};

if (isMain(import.meta.url)) {
  try {
    const cfg = readConfig();
    if (process.argv.includes('--after-build')) {
      const { out, files, count } = afterBuild(cfg);
      for (const [name, text] of Object.entries(files)) write(out, name, text);
      const pub = publicDir(cfg);
      const copied = BEFORE.filter((f) => !existsSync(join(out, f)) && existsSync(join(pub, f)));
      for (const f of copied) {
        mkdirSync(dirname(join(out, f)), { recursive: true });
        copyFileSync(join(pub, f), join(out, f));
      }
      console.log(`gen-public-files: sitemap.xml and llms.txt for ${count} page(s) in ${out}/${copied.length ? `; copied ${copied.join(', ')} from ${pub}/` : ''}`);
    } else {
      const pub = publicDir(cfg);
      const files = beforeBuild(cfg);
      for (const [name, text] of Object.entries(files)) write(pub, name, text);
      const { url, source } = siteUrl(cfg);
      console.log(`gen-public-files: ${Object.keys(files).join(', ')} in ${pub}/ for ${url}${source === 'template' ? ' (template mode: no project.domain yet)' : ''}`);
    }
  } catch (e) {
    console.error(`gen-public-files: ${e.message}`);
    process.exitCode = 1;
  }
}
