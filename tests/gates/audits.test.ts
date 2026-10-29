// The audits' decision logic (scripts/audits/perf.mjs, a11y.mjs, unique-text.mjs, ga-live.mjs) and the Lighthouse
// budgets, on planted measurements. The browser runs themselves are exercised by the audit scripts, not here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { budgetProblems, median } from '../../scripts/audits/perf.mjs';
import { summarise } from '../../scripts/audits/a11y.mjs';
import { THRESHOLD, pageWords, uniqueness } from '../../scripts/audits/unique-text.mjs';
import { SENTINEL, eventsOf, visitProblems } from '../../scripts/audits/ga-live.mjs';

const REPO = path.resolve(__dirname, '..', '..');
const factory = JSON.parse(readFileSync(path.join(REPO, 'factory.config.json'), 'utf8'));
const cwv = factory.budgets.coreWebVitals;

describe('audit:perf', () => {
  it('takes the median run', () => {
    expect(median([900, 3000, 1000])).toBe(1000);
  });

  it('fails a page over the LCP, CLS or TBT budget (planted)', () => {
    expect(budgetProblems([{ path: '/', lcp: 1200, cls: 0.01, tbt: 50 }], cwv)).toEqual([]);
    expect(budgetProblems([{ path: '/slow/', lcp: 3100, cls: 0.25, tbt: 450 }], cwv).map((p: { metric: string }) => p.metric)).toEqual(['LCP', 'CLS', 'TBT (INP proxy)']);
  });
});

describe('audit:a11y', () => {
  it('lists each violation with its page and counts the nodes', () => {
    const r = summarise([{ path: '/', violations: [{ id: 'color-contrast', impact: 'serious', nodes: 2, help: 'Elements must meet minimum color contrast', sample: '.muted' }] }, { path: '/about/', violations: [] }]);
    expect(r.total).toBe(2);
    expect(r.lines).toEqual(['/  color-contrast (serious, 2 node(s)): Elements must meet minimum color contrast; e.g. .muted']);
  });
});

describe('audit:unique', () => {
  const text = (seed: string, n = 200) => `<main><nav>Home Section</nav><h1>${seed}</h1><p>${Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ')}</p><aside>Related links</aside></main>`;

  it('ignores navigation, asides and forms, which repeat by design', () => {
    expect(pageWords('<main><nav>a b</nav><p>c d</p><form>e</form><aside>f</aside></main>')).toEqual(['c', 'd']);
  });

  it('passes distinct pages and fails a near-duplicate (planted doorway page)', () => {
    const distinct = uniqueness([{ route: '/a/x/', html: text('alpha') }, { route: '/a/y/', html: text('beta') }]);
    expect(distinct.every((r: { unique: number }) => r.unique >= THRESHOLD)).toBe(true);
    const copy = text('alpha').replace('<h1>alpha</h1>', '<h1>alpha again</h1>');
    const dup = uniqueness([{ route: '/a/x/', html: text('alpha') }, { route: '/a/z/', html: copy }]);
    expect(dup.find((r: { route: string }) => r.route === '/a/z/').unique).toBeLessThan(THRESHOLD);
  });
});

describe('audit:ga', () => {
  const hit = (params: string) => ({ url: `https://region1.google-analytics.com/g/collect?v=2&tid=G-TEST1234&${params}`, body: '' });
  const first = 'https://example-site.test/';
  const second = 'https://example-site.test/about/';

  it('passes one clean page_view per navigation', () => {
    const ev = eventsOf([hit(`en=page_view&dl=${encodeURIComponent(first)}&dt=Home`), hit(`en=page_view&dl=${encodeURIComponent(second)}&dt=About`)]);
    expect(visitProblems(ev, { first, second })).toEqual([]);
  });

  it('fails a query string or the sentinel reaching GA4 (planted)', () => {
    const ev = eventsOf([hit(`en=page_view&dl=${encodeURIComponent(`${first}?q=${SENTINEL}`)}&dt=Home`), hit(`en=page_view&dl=${encodeURIComponent(second)}&dt=About`)]);
    const p = visitProblems(ev, { first, second }).join('\n');
    expect(p).toMatch(/sentinel/);
    expect(p).toMatch(/query string/);
  });

  it('drops exact repeats as retries, but fails a second page view of one navigation and form tracking', () => {
    const view = hit(`en=page_view&dl=${encodeURIComponent(second)}&dt=About`);
    expect(eventsOf([view, view])).toHaveLength(1);
    const ev = eventsOf([
      hit(`en=page_view&dl=${encodeURIComponent(first)}&dt=Home`),
      view,
      hit(`en=page_view&dl=${encodeURIComponent(second)}&dt=About&dr=${encodeURIComponent(first)}`), // a history-based view
      hit('en=form_start&dl=x'),
    ]);
    const p = visitProblems(ev, { first, second }).join('\n');
    expect(p).toMatch(/2 page_view\(s\) for/);
    expect(p).toMatch(/form interactions are on/);
  });
});

describe('audit:lighthouse budgets', () => {
  const lhci = JSON.parse(readFileSync(path.join(REPO, 'lighthouserc.json'), 'utf8')).ci;
  const a = lhci.assert.assertions;

  it('match factory.config.json → budgets', () => {
    const lh = factory.budgets.lighthouse;
    expect(a['categories:performance'][1].minScore).toBe(lh.performance / 100);
    expect(a['categories:accessibility'][1].minScore).toBe(lh.accessibility / 100);
    expect(a['categories:best-practices'][1].minScore).toBe(lh.bestPractices / 100);
    expect(a['categories:seo'][1].minScore).toBe(lh.seo / 100);
    expect(a['largest-contentful-paint'][1].maxNumericValue).toBe(cwv.lcpMs);
    expect(a['cumulative-layout-shift'][1].maxNumericValue).toBe(cwv.cls);
    expect(a['total-blocking-time'][1].maxNumericValue).toBe(cwv.inpMs);
    for (const k of ['categories:performance', 'categories:accessibility', 'categories:best-practices', 'categories:seo']) expect(a[k][0], k).toBe('error');
  });

  it('runs on mobile against the local server the e2e tests use', () => {
    expect(lhci.collect.settings.formFactor).toBe('mobile');
    for (const u of lhci.collect.url) expect(u).toMatch(/^http:\/\/localhost:4321\//);
    expect(readFileSync(path.join(REPO, 'playwright.config.ts'), 'utf8')).toMatch(/4321/);
  });
});
