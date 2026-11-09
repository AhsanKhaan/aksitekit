// The strategy and seo stages' google-sources check in gate.mjs (docs/SEO-GATE.md §5): each report lists every Google
// page in seo-checks.json → googleSources with the date it was read. A clean report passes; each planted failure fails.
// Everything runs in temporary folders with fake data; the real repo, config and ledger are never touched.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PASS = 0;
const FAIL = 1;
const BLOCKED = 3; // the check passed and the seo stage stopped at its npm scripts, which a fake project doesn't have

type Source = { page: string; url: string };
const SEO_CHECKS = JSON.parse(readFileSync(path.join(REPO, 'seo-checks.json'), 'utf8'));
const REQUIRED: Source[] = SEO_CHECKS.googleSources.required;
const MAX_AGE: number = SEO_CHECKS.googleSources.maxAgeDays;

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const norm = (u: string) => {
  const x = new URL(u);
  return `${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, '')}`;
};

function table(rows: { url: string; page?: string; date?: string }[], heading = '## Google sources checked') {
  const body = rows.map((r) => `| A rule | ${r.page ?? 'A Google page'} | ${r.url} | ${r.date ?? ''} |`).join('\n');
  return `${heading}\n\n| Rule | Google page | URL | Checked |\n|---|---|---|---|\n${body}\n`;
}
const allFresh = (date = daysAgo(0)) => REQUIRED.map((r) => ({ ...r, date }));
// Every required page read today, except row i, which gets the given date.
const redate = (i: number, date: string) => allFresh().map((r, j) => (j === i ? { ...r, date } : r));
const FIRST = REQUIRED[0]!;

function project(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-google-'));
  temps.push(root);
  mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  cpSync(path.join(REPO, '.claude', 'skills', 'gate'), path.join(root, '.claude', 'skills', 'gate'), { recursive: true });
  cpSync(path.join(REPO, '.claude', 'hooks'), path.join(root, '.claude', 'hooks'), { recursive: true }); // gate.mjs imports secret-patterns.mjs
  cpSync(path.join(REPO, 'package.json'), path.join(root, 'package.json')); // gate.mjs reads the npm script names
  cpSync(path.join(REPO, 'seo-checks.json'), path.join(root, 'seo-checks.json')); // the real required list
  const cfg = { project: { name: 'Example', domain: 'example-site.test' }, hosting: { target: 'cloudflare-pages' }, build: { outputDir: 'out' } };
  writeFileSync(path.join(root, 'factory.config.json'), JSON.stringify(cfg));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const gate = (root: string, stage: string) => {
  const r = spawnSync(process.execPath, [path.join(root, '.claude', 'skills', 'gate', 'gate.mjs'), stage, '--dry-run'], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
};

const seoReport = (section: string) => `# SEO audit\n\nNo blockers [M].\n\n${section}\n## Manual checks\nRich Results Test.\n`;
const seo = (section: string) => gate(project({ 'reports/seo.md': seoReport(section) }), 'seo');

describe('google-sources: the required list', () => {
  test('seo-checks.json lists https Google pages and a 90-day limit', () => {
    expect(MAX_AGE).toBe(90);
    expect(REQUIRED.length).toBeGreaterThan(0);
    for (const r of REQUIRED) {
      expect(r.page.trim()).not.toBe('');
      expect(new URL(r.url).protocol).toBe('https:');
      expect(new URL(r.url).hostname).toMatch(/(^|\.)google\.com$/);
    }
  });

  test('the content-strategy template and SEO-GATE.md list the same pages as seo-checks.json', () => {
    const urls = (file: string) => new Set([...readFileSync(path.join(REPO, file), 'utf8').matchAll(/https:\/\/developers\.google\.com\/[^\s|)]+/g)].map((m) => norm(m[0])));
    const want = REQUIRED.map((r) => norm(r.url));
    for (const file of ['docs/templates/CONTENT-STRATEGY.md', 'docs/SEO-GATE.md']) {
      const have = urls(file);
      for (const u of want) expect(have.has(u), `${file} is missing ${u}`).toBe(true);
    }
  });
});

describe('google-sources: seo stage', () => {
  test('every required page, read today, passes the check', () => {
    const r = seo(table(allFresh()));
    expect(r.status, r.out).toBe(BLOCKED);
    expect(r.out).not.toMatch(/Google sources checked"? section|doesn't list|days ago|isn't an https Google page/);
  });

  test('a page read 89 days ago still passes; extra Google pages and trailing slashes are fine', () => {
    const rows = [...allFresh(daysAgo(89)).map((r) => ({ ...r, url: `${r.url}/` })), { url: 'https://developers.google.com/search/docs/appearance/snippet', date: daysAgo(3) }];
    const r = seo(table(rows));
    expect(r.status, r.out).toBe(BLOCKED);
  });

  test('a numbered heading at another level is found', () => {
    const r = seo(table(allFresh(), '### 7. Google sources checked'));
    expect(r.status, r.out).toBe(BLOCKED);
  });

  test('a report without the section fails (planted)', () => {
    const r = seo('');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/has no "## Google sources checked" section/);
  });

  test('a required page left out fails (planted)', () => {
    const r = seo(table(allFresh().slice(1)));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/doesn't list/);
    expect(r.out).toContain(FIRST.url);
  });

  test(`a page read more than ${MAX_AGE} days ago fails (planted)`, () => {
    const r = seo(table(redate(1, daysAgo(MAX_AGE + 30))));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(new RegExp(`checked ${daysAgo(MAX_AGE + 30)}, \\d+ days ago \\(limit ${MAX_AGE}\\)`));
  });

  test(`a page read exactly ${MAX_AGE} days ago passes (edge)`, () => {
    const r = seo(table(redate(1, daysAgo(MAX_AGE))));
    expect(r.status, r.out).toBe(BLOCKED);
  });

  test(`a page read ${MAX_AGE + 1} days ago fails (edge, planted)`, () => {
    const r = seo(table(redate(1, daysAgo(MAX_AGE + 1))));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(new RegExp(`${MAX_AGE + 1} days ago \\(limit ${MAX_AGE}\\)`));
  });

  // A date one day ahead of UTC is allowed: between local and UTC midnight, east of Greenwich, the local date is ahead.
  test('a date one day ahead of UTC passes (edge)', () => {
    const r = seo(table(redate(0, daysAgo(-1))));
    expect(r.status, r.out).toBe(BLOCKED);
  });

  test('a date two days ahead fails (edge, planted)', () => {
    const r = seo(table(redate(0, daysAgo(-2))));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/is in the future/);
  });

  test('a date well in the future fails (planted)', () => {
    const r = seo(table(redate(0, daysAgo(-10))));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/is in the future/);
  });

  test('a row without a date fails (planted)', () => {
    const r = seo(table(redate(2, '')));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/has no YYYY-MM-DD date/);
  });

  test('an impossible date fails (planted)', () => {
    const r = seo(table(redate(2, '2026-02-30')));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/2026-02-30 is not a real date/);
  });

  test('a look-alike host is not a Google page (planted)', () => {
    const r = seo(table([...allFresh(), { url: 'https://developers.google.com.example.test/search/docs/x', date: daysAgo(0) }]));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/isn't an https Google page/);
  });

  test('a second, non-Google link in a row fails (planted)', () => {
    const rows = allFresh().map((r, j) => (j === 0 ? { ...r, page: 'Spam policies, see also https://example.test/notes' } : r));
    const r = seo(table(rows));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/lists https:\/\/example\.test\/notes, which isn't an https Google page/);
  });

  test('a plain http link fails (planted)', () => {
    const r = seo(table([...allFresh(), { url: 'http://developers.google.com/search/docs/x', date: daysAgo(0) }]));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/isn't an https Google page/);
  });

  test('a row under the next heading does not count (planted)', () => {
    const section = `${table(allFresh().slice(1))}\n## Other notes\n\n| x | y | ${FIRST.url} | ${daysAgo(0)} |\n`;
    const r = seo(section);
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/doesn't list/);
  });
});

describe('google-sources: strategy stage', () => {
  const plan = { waves: [{ wave: 1, urls: ['/hub/'] }], schema: { hub: ['CollectionPage'] } };
  const map = [{ url: '/hub/', type: 'hub', primary: 'example hub' }];
  const files = (strategy: string) => ({
    'docs/CONTENT-STRATEGY.md': strategy,
    'research/out/content-plan.json': JSON.stringify(plan),
    'research/out/keyword-map.json': JSON.stringify(map),
    'research/out/briefs/hub.md': '# Brief: /hub/\n',
  });

  test('a strategy that lists every required page passes the stage', () => {
    const r = gate(project(files(`# Content strategy: Example\n\n## 5. Page standards\n\n${table(allFresh())}\n## 6. Briefs\n`)), 'strategy');
    expect(r.status, r.out).toBe(PASS);
    expect(r.out).toMatch(/Google sources: \d+ required page\(s\) listed/);
  });

  test('a strategy without the section fails (planted)', () => {
    const r = gate(project(files('# Content strategy: Example\n\n## 5. Page standards\nNo sources.\n')), 'strategy');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/docs\/CONTENT-STRATEGY\.md has no "## Google sources checked" section/);
  });

  test('the template copied with its dates unfilled fails on the placeholder first (planted)', () => {
    const template = readFileSync(path.join(REPO, 'docs', 'templates', 'CONTENT-STRATEGY.md'), 'utf8');
    const filledExceptDates = template.replace(/\{\{(?!CHECKED\}\})[A-Z0-9_]+\}\}/g, 'filled');
    const r = gate(project(files(filledExceptDates)), 'strategy');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/still has a template placeholder \(\{\{CHECKED\}\}\)/);
  });

  test('the template with its dates filled in passes', () => {
    const template = readFileSync(path.join(REPO, 'docs', 'templates', 'CONTENT-STRATEGY.md'), 'utf8');
    const filled = template.replace(/\{\{CHECKED\}\}/g, daysAgo(0)).replace(/\{\{[A-Z0-9_]+\}\}/g, 'filled');
    const r = gate(project(files(filled)), 'strategy');
    expect(r.status, r.out).toBe(PASS);
  });
});
