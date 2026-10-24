// Scan-target check (docs/BLUEPRINT.md, security table: probes only ever target the project's own preview or
// production hosts). Every ZAP scan and check:security run in CI passes its URL through here first.
//
//   TARGET_URL=<url> node .github/scripts/target-url.mjs
//
// Allowed hosts come from repo variables, passed through env:
//   LIVE_SITE_URL    https://example.com     the host, and its www./apex twin
//   LIVE_PAGES_HOST  <project>.pages.dev     the host, and every *.<project>.pages.dev preview
//   PREVIEW_URL      https://staging.example.com (optional fixed preview, e.g. a Workers preview)
// Options (env):
//   FALLBACK=true      an empty TARGET_URL becomes PREVIEW_URL, else https://LIVE_PAGES_HOST/
//   SKIP_FOREIGN=true  a host that isn't the project's skips the scan (a deployment_status event from another
//                      deployer) instead of failing it
// Writes `url` and `skip` to $GITHUB_OUTPUT. Exit 1 when the URL is invalid, or foreign without SKIP_FOREIGN.
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Host name from a bare host or a URL ("x.pages.dev", "https://x.pages.dev/"), lowercased; '' when unset. */
export function hostOf(value) {
  const v = (value ?? '').trim();
  if (!v) return '';
  try {
    return new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** The project's own hosts: exact hosts, plus the suffix that preview deployments live under. */
export function allowedHosts(env) {
  const exact = new Set();
  const site = hostOf(env.LIVE_SITE_URL);
  if (site) {
    exact.add(site);
    exact.add(site.startsWith('www.') ? site.slice(4) : `www.${site}`);
  }
  const pages = hostOf(env.LIVE_PAGES_HOST);
  if (pages) exact.add(pages);
  const preview = hostOf(env.PREVIEW_URL);
  if (preview) exact.add(preview);
  return { exact, suffixes: pages ? [`.${pages}`] : [] };
}

/**
 * Resolve and check a scan target. Returns { url } (origin + path, no query or fragment), { skip, reason } when
 * there is nothing to scan, or throws when the target is invalid or (without skipForeign) not the project's own.
 */
export function checkTarget(env) {
  let raw = (env.TARGET_URL ?? '').trim();
  if (!raw && env.FALLBACK === 'true') {
    raw = (env.PREVIEW_URL ?? '').trim() || (hostOf(env.LIVE_PAGES_HOST) ? `https://${hostOf(env.LIVE_PAGES_HOST)}/` : '');
  }
  if (!raw) return { skip: true, reason: 'no target URL (set LIVE_PAGES_HOST or PREVIEW_URL, or pass a URL)' };
  if (/\s/.test(raw)) throw new Error('target URL contains whitespace');
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('target is not a valid URL');
  }
  if (u.protocol !== 'https:') throw new Error(`target must use https (got ${u.protocol})`);
  if (u.username || u.password) throw new Error('target must not contain credentials');
  if (u.port) throw new Error('target must use the default https port');
  const host = u.hostname.toLowerCase();
  const { exact, suffixes } = allowedHosts(env);
  if (!exact.has(host) && !suffixes.some((s) => host.endsWith(s))) {
    const why = exact.size
      ? `${host} is not one of this project's hosts (${[...exact, ...suffixes.map((s) => `*${s}`)].join(', ')})`
      : `${host} can't be checked: set the LIVE_SITE_URL, LIVE_PAGES_HOST or PREVIEW_URL repo variable first`;
    if (env.SKIP_FOREIGN === 'true') return { skip: true, reason: why };
    throw new Error(why);
  }
  return { url: `${u.origin}${u.pathname}` };
}

export function writeOutputs(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  else console.log(lines);
}

const runDirectly = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (runDirectly) {
  try {
    const r = checkTarget(process.env);
    if (r.skip) {
      console.log(`::notice::scan skipped: ${r.reason}`);
      writeOutputs({ url: '', skip: 'true' });
    } else {
      console.log(`target: ${r.url}`);
      writeOutputs({ url: r.url, skip: 'false' });
    }
  } catch (err) {
    console.log(`::error::${err.message}`);
    process.exit(1);
  }
}
