// The first build step (scripts/production-gate.mjs): production builds need the project's real values and no
// example content; previews are never indexable. Every case is planted in memory.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exampleContent, gateProblems } from '../../scripts/production-gate.mjs';

const REPO = path.resolve(__dirname, '..', '..');
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ready = {
  project: { name: 'Example', domain: 'example-site.test', brand: 'Example Site' },
  hosting: { target: 'cloudflare-pages', productionBranch: 'main' },
  bots: { search: 'allow', adsense: 'allow', aiSearch: 'allow', aiTraining: 'block' },
  analytics: { ga4MeasurementId: '' },
  monetization: { adsense: { enabled: false, publisherId: '' } },
};
const prod = { SITE_ENV: 'production', SITE_INDEXABLE: 'true', SITE_URL: 'https://example-site.test' };
const clean = { examples: [], keywordMapExists: true };

describe('production builds', () => {
  it('pass with the real values and no examples', () => {
    expect(gateProblems(ready, prod, clean)).toEqual({ context: 'production', problems: [] });
  });

  it('also count as production on a Cloudflare Pages build of the production branch', () => {
    expect(gateProblems(ready, { CF_PAGES: '1', CF_PAGES_BRANCH: 'main', SITE_INDEXABLE: 'true', SITE_URL: 'https://www.example-site.test' }, clean).context).toBe('production');
  });

  it('fail with any example content left (planted: the template as it ships)', () => {
    const { problems } = gateProblems(ready, prod, { examples: exampleContent(path.join(REPO, 'content')), keywordMapExists: true });
    expect(problems.length).toBeGreaterThanOrEqual(7);
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/content\/site\.json is a template example/), expect.stringMatching(/content\/pages\/home\.json is a template example/)]));
  });

  it('fail without a domain, a name, an indexable flag or the research keyword map', () => {
    const { problems } = gateProblems({ ...ready, project: { name: '', domain: '', brand: '' } }, { SITE_ENV: 'production' }, { examples: [], keywordMapExists: false });
    expect(problems.join('\n')).toMatch(/project\.domain is empty/);
    expect(problems.join('\n')).toMatch(/project\.name \(or brand\) is empty/);
    expect(problems.join('\n')).toMatch(/must set SITE_INDEXABLE=true/);
    expect(problems.join('\n')).toMatch(/keyword-map\.json is missing/);
  });

  it('fail when the site URL is not the project domain (every canonical would point elsewhere)', () => {
    expect(gateProblems(ready, { ...prod, SITE_URL: 'https://example-site.pages.dev' }, clean).problems).toEqual([expect.stringMatching(/not https:\/\/example-site\.test/)]);
  });

  it('fail on an undecided bot policy, a bad GA4 id or ads without a publisher id', () => {
    const cfg = { ...ready, bots: { ...ready.bots, aiTraining: 'ask' }, analytics: { ga4MeasurementId: 'UA-123' }, monetization: { adsense: { enabled: true, publisherId: 'pub-1' } } };
    const text = gateProblems(cfg, prod, clean).problems.join('\n');
    expect(text).toMatch(/bots\.aiTraining is "ask"/);
    expect(text).toMatch(/"UA-123" is not a GA4 measurement ID/);
    expect(text).toMatch(/publisherId is not "pub-" and 16 digits/);
  });
});

describe('preview and local builds', () => {
  it('refuse an indexable preview (planted: SITE_INDEXABLE on a branch build)', () => {
    expect(gateProblems(ready, { CF_PAGES: '1', CF_PAGES_BRANCH: 'feature/x', SITE_INDEXABLE: 'true' }, clean)).toEqual({ context: 'preview', problems: [expect.stringMatching(/must not be indexable/)] });
  });

  it('let the template build its examples locally', () => {
    expect(gateProblems({ ...ready, project: { name: '', domain: '', brand: '' } }, {}, { examples: ['content/site.json'], keywordMapExists: false })).toEqual({ context: 'local', problems: [] });
  });

  it('refuse Workers Builds on a Pages project', () => {
    expect(gateProblems(ready, { WORKERS_CI: '1' }, clean).problems).toEqual([expect.stringMatching(/Workers Builds \(WORKERS_CI=1\)/)]);
  });
});

describe('exampleContent', () => {
  it('finds files marked "example": true and files that do not parse', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'examples-'));
    temps.push(dir);
    mkdirSync(path.join(dir, 'pages'));
    writeFileSync(path.join(dir, 'pages', 'a.json'), JSON.stringify({ example: true }));
    writeFileSync(path.join(dir, 'pages', 'b.json'), JSON.stringify({ example: false }));
    writeFileSync(path.join(dir, 'c.json'), '{ not json');
    const found = exampleContent(dir).map((f: string) => path.basename(f));
    expect(found.sort()).toEqual(['a.json', 'c.json (doesn\'t parse)']);
  });
});
