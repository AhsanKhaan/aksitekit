// Preview URL for preprod.yml: where the pull request's head commit is deployed, so check:security and ZAP probe
// exactly what will ship.
//
//   node .github/scripts/preview-url.mjs
//
// Order:
//   1. INPUT_URL (workflow_dispatch input), else PREVIEW_URL (repo variable: a fixed preview, e.g. for Workers);
//   2. LIVE_PAGES_HOST set: wait for the Cloudflare Pages check run (or commit status) on HEAD_SHA, then take the
//      deployment URL it reports (*.<LIVE_PAGES_HOST>), falling back to the branch alias of HEAD_REF;
//   3. neither: skip, since no Cloudflare project is configured (the template repository itself).
// Every URL then goes through target-url.mjs (the project's own hosts only) and must answer below 400.
// Env: GITHUB_TOKEN (checks: read, statuses: read), GITHUB_REPOSITORY, GITHUB_API_URL, HEAD_SHA, HEAD_REF,
// WAIT_MINUTES (default 20). Writes `url` and `skip` to $GITHUB_OUTPUT.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkTarget, hostOf, writeOutputs } from './target-url.mjs';

/** Cloudflare Pages branch alias: lowercased, each non-alphanumeric character replaced with a hyphen. */
export const branchAlias = (ref) => (ref ?? '').toLowerCase().replace(/[^a-z0-9]/g, '-');

/** Deployment URLs under the Pages host found in a check run's text; a commit-hash URL first, then aliases. */
export function pagesUrls(text, pagesHost) {
  const host = pagesHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = [...new Set((text ?? '').match(new RegExp(`https://[a-z0-9-]+\\.${host}`, 'gi')) ?? [])].map((u) => `${u.toLowerCase()}/`);
  return found.sort((a, b) => Number(!/^https:\/\/[0-9a-f]{8}\./.test(a)) - Number(!/^https:\/\/[0-9a-f]{8}\./.test(b)));
}

const isCloudflare = (...names) => /cloudflare/i.test(names.filter(Boolean).join(' '));

/** One look at the commit: { state: 'success' | 'failure' | 'pending' | 'none', text } from Cloudflare's checks. */
export function cloudflareState(checkRuns, combinedStatus) {
  const runs = (checkRuns ?? []).filter((r) => isCloudflare(r.app?.slug, r.app?.name, r.name));
  const statuses = (combinedStatus?.statuses ?? []).filter((s) => isCloudflare(s.context));
  const text = [
    ...runs.flatMap((r) => [r.details_url, r.output?.title, r.output?.summary, r.output?.text]),
    ...statuses.flatMap((s) => [s.target_url, s.description]),
  ].filter(Boolean).join('\n');
  if (!runs.length && !statuses.length) return { state: 'none', text };
  if (runs.some((r) => r.conclusion === 'success') || statuses.some((s) => s.state === 'success')) return { state: 'success', text };
  if (runs.every((r) => r.status === 'completed') && statuses.every((s) => s.state !== 'pending')) return { state: 'failure', text };
  return { state: 'pending', text };
}

async function github(path) {
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const res = await fetch(`${api}${path}`, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'user-agent': 'adsense-site-factory-preprod',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} answered ${res.status}`);
  return res.json();
}

async function waitForPagesPreview(env) {
  const sha = env.HEAD_SHA ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('HEAD_SHA must be a full commit SHA');
  const repo = env.GITHUB_REPOSITORY ?? '';
  const pagesHost = hostOf(env.LIVE_PAGES_HOST);
  const deadline = Date.now() + Number(env.WAIT_MINUTES ?? 20) * 60_000;
  for (;;) {
    const runs = await github(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
    const status = await github(`/repos/${repo}/commits/${sha}/status`);
    const { state, text } = cloudflareState(runs.check_runs, status);
    if (state === 'success') {
      const urls = pagesUrls(text, pagesHost);
      if (urls.length) return urls[0];
      console.log('::warning::the Cloudflare check names no deployment URL; using the branch alias');
      return `https://${branchAlias(env.HEAD_REF)}.${pagesHost}/`;
    }
    if (state === 'failure') throw new Error(`the Cloudflare Pages build for ${sha.slice(0, 7)} failed; fix it, then re-run preprod`);
    if (Date.now() > deadline) {
      throw new Error(
        state === 'none'
          ? `no Cloudflare Pages check on ${sha.slice(0, 7)} after ${env.WAIT_MINUTES ?? 20} min: is the Pages project connected to this repo with preview deployments on? Otherwise set PREVIEW_URL, or run preprod by hand with preview_url`
          : `the Cloudflare Pages build for ${sha.slice(0, 7)} is still running after ${env.WAIT_MINUTES ?? 20} min`,
      );
    }
    console.log(`waiting for the Cloudflare Pages preview of ${sha.slice(0, 7)} (${state})`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

export async function resolvePreview(env) {
  const fixed = (env.INPUT_URL ?? '').trim() || (env.PREVIEW_URL ?? '').trim();
  let url = fixed;
  if (!url) {
    if (!hostOf(env.LIVE_PAGES_HOST)) return { skip: true, reason: 'no preview configured (set the LIVE_PAGES_HOST or PREVIEW_URL repo variable)' };
    url = await waitForPagesPreview(env);
  }
  const checked = checkTarget({ ...env, TARGET_URL: url, FALLBACK: 'false', SKIP_FOREIGN: 'false' });
  const res = await fetch(checked.url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (res.status >= 400) throw new Error(`preview ${checked.url} answered ${res.status}`);
  return checked;
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
    const r = await resolvePreview(process.env);
    if (r.skip) {
      console.log(`::notice::preview checks skipped: ${r.reason}`);
      writeOutputs({ url: '', skip: 'true' });
    } else {
      console.log(`preview: ${r.url}`);
      writeOutputs({ url: r.url, skip: 'false' });
    }
  } catch (err) {
    console.log(`::error::${err.message}`);
    process.exit(1);
  }
}
