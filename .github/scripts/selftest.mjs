// Self-test for the workflow helpers, run by ci.yml: each gate fails on a planted case (docs/TODO-step-c.md rule:
// every gate proves it fails when it should). No dependencies.
//
//   node .github/scripts/selftest.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudflareState, branchAlias, pagesUrls } from './preview-url.mjs';
import { scriptFiles, siteReady } from './site-ready.mjs';
import { checkTarget } from './target-url.mjs';
import { evaluate } from './zap-gate.mjs';

const env = { LIVE_SITE_URL: 'https://example.com', LIVE_PAGES_HOST: 'example-site.pages.dev' };

test('target-url: allows only the project own hosts', () => {
  assert.equal(checkTarget({ ...env, TARGET_URL: 'https://example.com/a/?q=1#x' }).url, 'https://example.com/a/');
  assert.equal(checkTarget({ ...env, TARGET_URL: 'https://www.example.com/' }).url, 'https://www.example.com/');
  assert.equal(checkTarget({ ...env, TARGET_URL: 'https://0a1b2c3d.example-site.pages.dev/' }).url, 'https://0a1b2c3d.example-site.pages.dev/');
  assert.throws(() => checkTarget({ ...env, TARGET_URL: 'https://evil.example.net/' }), /not one of this project's hosts/);
  assert.throws(() => checkTarget({ ...env, TARGET_URL: 'https://example-site.pages.dev.evil.net/' }), /not one of/);
  assert.throws(() => checkTarget({ ...env, TARGET_URL: 'http://example.com/' }), /https/);
  assert.throws(() => checkTarget({ ...env, TARGET_URL: 'https://user:pw@example.com/' }), /credentials/);
  assert.throws(() => checkTarget({ ...env, TARGET_URL: 'https://example.com/ -z -config' }), /whitespace/);
  assert.throws(() => checkTarget({ ...env, TARGET_URL: 'https://example.com:8443/' }), /port/);
  assert.throws(() => checkTarget({ TARGET_URL: 'https://example.com/' }), /set the LIVE_SITE_URL/);
});

test('target-url: skips instead of failing where asked', () => {
  assert.equal(checkTarget({ ...env, TARGET_URL: 'https://other.vercel.app/', SKIP_FOREIGN: 'true' }).skip, true);
  assert.equal(checkTarget({ ...env, TARGET_URL: '' }).skip, true);
  assert.equal(checkTarget({ ...env, TARGET_URL: '', FALLBACK: 'true' }).url, 'https://example-site.pages.dev/');
  assert.equal(checkTarget({ ...env, PREVIEW_URL: 'https://staging.example.org/', FALLBACK: 'true' }).url, 'https://staging.example.org/');
});

const rule = (id, level, note = '') => [id, level, `(rule ${id})`, note].filter((c, i) => i < 3 || c).join('\t');
const report = (...alerts) => ({ site: [{ '@name': 'https://example.com', alerts }] });
const alert = (pluginid, riskcode, extra = {}) => ({ pluginid, riskcode, confidence: '2', name: `alert ${pluginid}`, count: '1', instances: [{ uri: 'https://example.com/' }], ...extra });
const today = '2026-10-25';

test('zap-gate: fails on Medium and High alerts outside the exceptions (planted)', () => {
  const r = evaluate(report(alert('40012', '3'), alert('10098', '2'), alert('10021', '1'), alert('10027', '0')), '', today);
  assert.deepEqual(r.failures.map((f) => f.id), ['40012', '10098']);
  assert.equal(r.problems.length, 0);
});

test('zap-gate: a reviewed exception passes; FAIL rules fail at any risk', () => {
  const rules = [`# comment`, rule('10098', 'IGNORE', 'public static files, no cookies or auth; reviewed 2026-10-01'), rule('10021', 'FAIL')].join('\n');
  const r = evaluate(report(alert('10098', '2'), alert('10021', '1')), rules, today);
  assert.deepEqual(r.excepted.map((e) => e.id), ['10098']);
  assert.deepEqual(r.failures.map((f) => f.id), ['10021']);
});

test('zap-gate: exceptions need a reason and a recent review date (planted)', () => {
  assert.match(evaluate(report(), rule('10098', 'IGNORE'), today).problems.join(), /fourth column/);
  assert.match(evaluate(report(), rule('10098', 'IGNORE', 'reviewed 2026-10-01'), today).problems.join(), /fourth column/);
  assert.match(evaluate(report(), rule('10098', 'IGNORE', 'public static files, no auth; reviewed 2024-01-01'), today).problems.join(), /review it again/);
  assert.match(evaluate(report(), '10098 IGNORE spaces-not-tabs', today).problems.join(), /tab-separated/);
  assert.match(evaluate({}, '', today).problems.join(), /not a ZAP JSON report/);
});

test('zap-gate: false positives never count; report text is sanitised', () => {
  assert.equal(evaluate(report(alert('40012', '3', { confidence: '0' })), '', today).failures.length, 0);
  const [f] = evaluate(report(alert('40012', '3', { instances: [{ uri: 'https://example.com/?x=\n::error::pwned|' }] })), '', today).failures;
  assert.ok(!f.example.includes('\n') && !f.example.includes('::') && !f.example.includes('|'));
});

test('preview-url: branch alias and Cloudflare check parsing', () => {
  assert.equal(branchAlias('Feature/New_Page'), 'feature-new-page');
  const summary = 'Branch Preview URL: https://feature-x.example-site.pages.dev\nPreview URL: https://0a1b2c3d.example-site.pages.dev';
  assert.deepEqual(pagesUrls(summary, 'example-site.pages.dev'), ['https://0a1b2c3d.example-site.pages.dev/', 'https://feature-x.example-site.pages.dev/']);
  assert.deepEqual(pagesUrls('https://evil.net/https://x', 'example-site.pages.dev'), []);
  const run = (status, conclusion) => ({ app: { slug: 'cloudflare-workers-and-pages' }, name: 'Cloudflare Pages', status, conclusion, output: { summary } });
  assert.equal(cloudflareState([], { statuses: [] }).state, 'none');
  assert.equal(cloudflareState([run('in_progress', null)], {}).state, 'pending');
  assert.equal(cloudflareState([run('completed', 'failure')], {}).state, 'failure');
  assert.equal(cloudflareState([run('completed', 'success')], {}).state, 'success');
  assert.equal(cloudflareState([{ app: { slug: 'github-actions' }, name: 'ci', status: 'completed', conclusion: 'success' }], {}).state, 'none');
  assert.equal(cloudflareState([], { statuses: [{ context: 'Cloudflare Pages', state: 'success', target_url: 'https://0a1b2c3d.example-site.pages.dev' }] }).state, 'success');
});

test('site-ready: template mode until a project exists (planted)', () => {
  const pkg = { scripts: { 'check:repo': 'node scripts/check-repo.mjs', audit: 'node scripts/audit.mjs', lint: 'eslint .', typecheck: 'tsc --noEmit', build: 'node scripts/production-gate.mjs && node scripts/framework.mjs build', 'test:e2e': 'playwright test' } };
  const all = () => true;
  const none = () => false;
  assert.deepEqual(scriptFiles('node a.mjs && node scripts/b.js build | node c.mjs'), ['a.mjs', 'scripts/b.js', 'c.mjs']);
  assert.equal(siteReady({ config: { project: { domain: '' } }, pkg, exists: all }).ready, false); // the template itself
  assert.match(siteReady({ config: { project: { domain: '' } }, pkg, exists: all }).reason, /project\.domain is empty/);
  const notBuilt = siteReady({ config: { project: { domain: 'example.com' } }, pkg, exists: (f) => f !== 'scripts/production-gate.mjs' });
  assert.equal(notBuilt.ready, false); // after /start, before Step C
  assert.match(notBuilt.reason, /missing scripts\/production-gate\.mjs/);
  assert.equal(siteReady({ config: { project: { domain: 'example.com' } }, pkg: { scripts: {} }, exists: all }).ready, false);
  assert.equal(siteReady({ config: { project: { domain: 'example.com' } }, pkg, exists: none }).ready, false);
  assert.equal(siteReady({ config: { project: { domain: 'example.com' } }, pkg, exists: all }).ready, true); // a real project
});
