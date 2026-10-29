// The first step of `npm run build` (fails fast, before the framework runs). It decides what kind of build this is
// and refuses the ones that must never ship (docs/TODO-step-c.md §3):
// - production (SITE_ENV=production in CI, or a Cloudflare Pages build of hosting.productionBranch): the project's
//   values are set, the site URL is the project's own domain, the build is indexable, the bot policy is decided, and
//   no example page or example site fact remains;
// - preview (a Cloudflare Pages build of any other branch, or SITE_ENV=preview): never indexable;
// - local: anything goes (the template builds its example pages against example.com).
// It also refuses Workers Builds on a Pages project: `npx wrangler deploy` there installs unpinned packages.
//
//   node scripts/production-gate.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DOMAIN, buildContext, domainOf, indexable, isMain, readConfig, siteUrl } from './lib/site.mjs';
import { botPolicyProblems } from './lib/public-files.mjs';

const CONTENT = process.env.SITE_CONTENT_DIR || 'content';
const KEYWORD_MAP = process.env.KEYWORD_MAP || 'research/out/keyword-map.json';

/** Content files still marked as the template's examples ("example": true), and the example site facts. */
export function exampleContent(dir = CONTENT) {
  const found = [];
  const scan = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) scan(p);
      else if (e.name.endsWith('.json')) {
        try {
          const data = JSON.parse(readFileSync(p, 'utf8'));
          if (data?.example === true) found.push(p.split('\\').join('/'));
        } catch {
          found.push(`${p.split('\\').join('/')} (doesn't parse)`);
        }
      }
    }
  };
  scan(dir);
  return found;
}

/**
 * Problems for this build; empty when it may go ahead.
 * @param {any} cfg
 * @param {import('./lib/site.mjs').Env} [env]
 * @param {{ examples?: string[], keywordMapExists?: boolean }} [found]
 */
export function gateProblems(cfg, env = process.env, { examples = exampleContent(), keywordMapExists = existsSync(KEYWORD_MAP) } = {}) {
  const problems = [];
  if (env.WORKERS_CI === '1' && cfg.hosting?.target !== 'cloudflare-workers') {
    problems.push(`Workers Builds (WORKERS_CI=1) is not this project's deploy path (hosting.target is "${cfg.hosting?.target}"): disconnect the Worker connected to this repository`);
  }
  const context = buildContext(cfg, env);
  if (context === 'production') {
    const domain = domainOf(cfg);
    if (!DOMAIN.test(domain)) problems.push('factory.config.json → project.domain is empty or not a domain (run /start intake)');
    if (!String(cfg.project?.name || cfg.project?.brand || '').trim()) problems.push('factory.config.json → project.name (or brand) is empty');
    const { url } = siteUrl(cfg, env);
    if (domain && ![`https://${domain}`, `https://www.${domain}`].includes(url)) problems.push(`the site URL is ${url}, not https://${domain}: every canonical would point elsewhere (set LIVE_SITE_URL)`);
    if (!indexable(env)) problems.push('production builds must set SITE_INDEXABLE=true (or NEXT_PUBLIC_INDEXABLE=true), or the live site ships noindex');
    problems.push(...botPolicyProblems(cfg.bots));
    if (!keywordMapExists) problems.push(`${KEYWORD_MAP} is missing: the build would publish the template's example keyword map (run the keyword stage)`);
    for (const f of examples) problems.push(`${f} is a template example ("example": true): replace it with the project's own content or delete it`);
    const ga = String(cfg.analytics?.ga4MeasurementId ?? '');
    if (ga && !/^G-[A-Z0-9]{4,}$/.test(ga)) problems.push(`analytics.ga4MeasurementId "${ga}" is not a GA4 measurement ID (G-XXXXXXXX)`);
    const ads = cfg.monetization?.adsense ?? {};
    if (ads.enabled === true && !/^pub-\d{16}$/.test(String(ads.publisherId ?? ''))) problems.push('monetization.adsense.enabled is true but publisherId is not "pub-" and 16 digits');
  } else if (context === 'preview' && indexable(env)) {
    problems.push(`a preview build (${env.CF_PAGES_BRANCH || env.SITE_ENV}) must not be indexable: unset SITE_INDEXABLE and NEXT_PUBLIC_INDEXABLE for previews`);
  }
  return { context, problems };
}

if (isMain(import.meta.url)) {
  try {
    const cfg = readConfig();
    const { context, problems } = gateProblems(cfg);
    for (const p of problems) console.error(`production-gate: ${p}`);
    if (problems.length) process.exitCode = 1;
    else {
      const { url, source } = siteUrl(cfg);
      const examples = exampleContent().length;
      console.log(`production-gate: OK (${context} build for ${url}${source === 'template' ? ', template mode' : ''}${indexable() ? ', indexable' : ', noindex'}${examples ? `, ${examples} example file(s), allowed outside production` : ''})`);
    }
  } catch (e) {
    console.error(`production-gate: ${e.message}`);
    process.exitCode = 1;
  }
}
