// On-page SEO gate (scripts/audits/seo-checks.mjs, docs/SEO-GATE.md): a clean fake site passes, and each planted
// problem fails its own check. The fixtures are small fake sites written in the test; every page in them is fake data.
import { afterAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/audits/seo-checks.mjs', import.meta.url));
const SITE = 'https://example.test';
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const HEADERS = `/*
  Content-Security-Policy: default-src 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=()
  X-Frame-Options: DENY

https://example.test/*
  Strict-Transport-Security: max-age=86400
`;
const PROSE = 'Mortar mixes cement, sand and water. Pour it into a bucket, stir until smooth, then spread it with a trowel along each course of bricks. '
  .repeat(4) + 'Bricklayers check each course with a level and string line so the wall stays straight and plumb. ';

function page(route: string, o: { title?: string; h1?: string; body?: string; canonical?: string | null; jsonld?: string; extraHead?: string } = {}) {
  const title = o.title ?? `Mortar Mixing Guide for ${route === '/' ? 'Home' : route.replaceAll('/', ' ').trim()} Projects`;
  const canonical = o.canonical === null ? '' : `<link rel="canonical" href="${o.canonical ?? SITE + route}"/>`;
  return `<!DOCTYPE html><html lang="en-US"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title><meta name="description" content="A plain guide to mixing and laying mortar for small brick projects, with the ratios, the tools and the mistakes to avoid."/>
${canonical}<link rel="icon" href="/icon.svg"/><meta name="robots" content="noindex, nofollow"/>
<meta property="og:title" content="${title}"/><meta property="og:description" content="Mortar guide"/><meta property="og:image" content="${SITE}/og.png"/>
<meta property="og:url" content="${o.canonical ?? SITE + route}"/><meta name="twitter:card" content="summary_large_image"/>${o.extraHead ?? ''}
<script type="application/ld+json">${o.jsonld ?? `{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Mortar","url":"${SITE + route}"}]}`}</script></head>
<body><a href="#main">Skip to content</a><header><nav aria-label="Main"><a href="/">Home</a></nav></header>
<main id="main"><h1>${o.h1 ?? 'Mixing mortar for brickwork'}</h1>${o.body ?? `<section><h2>Steps</h2><p>${PROSE}</p><p>Updated <time datetime="2026-10-25">Oct 25, 2026</time>. Sources: <a href="https://www.nist.gov/">NIST</a>.</p></section>`}</main>
<footer><a href="/about/">About</a> <a href="/contact/">Contact</a> <a href="/privacy/">Privacy</a> <a href="/terms/">Terms</a>
<a href="/editorial-policy/">Editorial policy</a> <a href="/authors/sam/">Sam</a> <a href="/llms.txt">llms.txt</a>
<p>Disclaimer: estimates only, not professional advice.</p></footer></body></html>`;
}

const TRUST = ['/about/', '/contact/', '/privacy/', '/terms/', '/editorial-policy/', '/authors/sam/'];
interface Options { config?: Record<string, unknown>; factory?: unknown; keywordMap?: unknown; env?: Record<string, string> }
function site(pages: Record<string, string>, exceptions: unknown[] = [], o: Options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'seo-checks-'));
  roots.push(root);
  const out = join(root, 'out');
  const all: Record<string, string> = Object.fromEntries(TRUST.map((r) => [r, page(r)]));
  Object.assign(all, pages);
  for (const [route, html] of Object.entries(all)) {
    mkdirSync(join(out, route), { recursive: true });
    writeFileSync(join(out, route, 'index.html'), html);
  }
  writeFileSync(join(out, '_headers'), HEADERS);
  writeFileSync(join(out, 'og.png'), 'png');
  writeFileSync(join(out, 'llms.txt'), '# llms');
  const config = {
    outDir: out, siteUrl: SITE, siteName: 'Example Site', siteUrlEnv: 'NO_SUCH_ENV', indexableEnv: 'NO_SUCH_ENV', keywordMap: null as string | null,
    authorPathPrefix: '/authors/', editorialPath: '/editorial-policy/', disclosurePath: '/disclosure/', searchBots: ['Googlebot'],
    thresholds: {
      titleMinChars: 30, titleMaxChars: 60, titleMaxPx: 580, descMinChars: 70, descMaxChars: 160, descMaxPx: 920, densityMinWords: 50,
      targetDensityWarn: 5, targetDensityFail: 6, targetStemFail: 8, anyWordDensityWarn: 6, anyWordDensityFail: 8, textHtmlRatioMin: 10,
      readingGradeMax: 30, linkDensityMax: 40, minWords: 10, headingMaxChars: 70, renderBlockingMax: 0, htmlWarnKb: 100, htmlBudgetKb: 450,
      inlineJsWarnKb: 50, inlineJsBudgetKb: 300, inlineCssMaxKb: 60, domWarn: 800, domFail: 1400, maxLinks: 300, maxExternalLinks: 50,
      maxUrlDepth: 3, maxUrlLength: 100, authorBioMinWords: 20, htmlMaxMb: 2, responseMsMax: 600,
    },
    exceptions,
    ...o.config,
  };
  if (o.keywordMap) {
    writeFileSync(join(root, 'keyword-map.json'), JSON.stringify(o.keywordMap));
    config.keywordMap = join(root, 'keyword-map.json');
  }
  if (o.factory) writeFileSync(join(root, 'factory.config.json'), JSON.stringify(o.factory));
  writeFileSync(join(root, 'seo-checks.json'), JSON.stringify(config));
  // Relative paths (a blank outDir filled from factory.config.json) resolve from the fixture root, like a project's.
  const env = { ...process.env, SEO_CHECKS_CONFIG: join(root, 'seo-checks.json'), SEO_CHECKS_FACTORY: join(root, 'factory.config.json'), ...o.env };
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: root, encoding: 'utf8', env });
  const json = r.stdout.slice(0, r.stdout.lastIndexOf('}') + 1);
  const report = (json ? JSON.parse(json).report : []) as { route: string; id: string; status: string; msg: string }[];
  return { status: r.status, stderr: r.stderr, report, result: (route: string, id: string) => report.find((x) => (x.route === route || x.route === '(site)') && x.id === id) };
}

describe('seo-checks', () => {
  test('a clean fake site has no failures', () => {
    const s = site({ '/': page('/'), '/guide/': page('/guide/') });
    expect(s.report.filter((x) => x.status === 'fail')).toEqual([]);
    expect(s.status).toBe(0);
  });

  test('keyword stuffing fails at the audit level (a target term over 6% of meaningful words)', () => {
    const body = `<section><h2>Widgets</h2><p>${'Widget pricing changes. '.repeat(12)}${PROSE}</p><p><time datetime="2026-10-25">x</time></p></section>`;
    const s = site({ '/': page('/', { title: 'Widget Calculator for Home Projects Today', h1: 'Widget calculator', body }) });
    expect(s.result('/', 'content.keyword-stuffing')).toMatchObject({ status: 'fail' });
    expect(s.result('/', 'content.keyword-stuffing')!.msg).toContain('"widget"');
    expect(s.status).toBe(1);
  });

  test('a month name filling a date table only warns, and a real repeat behind it still fails', () => {
    const rows = Array.from({ length: 14 }, (_, i) => `<tr><th scope="row">+${i + 1}</th><td>Thursday, November ${i + 5}, 2026</td></tr>`).join('');
    const table = `<table><caption>Dates ahead</caption>${rows}</table>`;
    const dates = site({ '/': page('/', { body: `<section><h2>Dates</h2><p>${PROSE}</p>${table}</section>` }) });
    expect(dates.result('/', 'content.keyword-stuffing')).toMatchObject({ status: 'warn' });
    expect(dates.result('/', 'content.keyword-stuffing')!.msg).toContain('a date name');
    const stuffed = `<p>${'Grout sealing helps. '.repeat(14)}</p>`;
    const both = site({ '/': page('/', { body: `<section><h2>Dates</h2><p>${PROSE}</p>${stuffed}${table}</section>` }) });
    expect(both.result('/', 'content.keyword-stuffing')).toMatchObject({ status: 'fail' });
    expect(both.result('/', 'content.keyword-stuffing')!.msg).toContain('"grout"');
  });

  test('the site name is a brand, not a target term', () => {
    const body = `<section><h2>About</h2><p>${'Example Site helps. '.repeat(6)}${PROSE}</p></section>`;
    const s = site({ '/': page('/', { title: 'About Example Site and Its Mortar Guides', body }) });
    expect(s.result('/', 'content.keyword-stuffing')?.msg ?? '').not.toContain('target "example"');
  });

  test('blank settings come from factory.config.json: output folder, domain and brand', () => {
    const body = `<section><h2>About</h2><p>${'Example Site helps. '.repeat(6)}${PROSE}</p></section>`;
    const s = site({ '/': page('/', { title: 'About Example Site and Its Mortar Guides', body }) }, [], {
      config: { outDir: '', siteUrl: '', siteName: '' },
      factory: { build: { outputDir: 'out' }, project: { domain: 'example.test', brand: 'Example Site' } },
    });
    expect(s.result('/', 'core.canonical-self')).toMatchObject({ status: 'pass' });
    expect(s.result('/', 'content.keyword-stuffing')?.msg ?? '').not.toContain('target "example"');
  });

  test("the template's keyword map shape ({ pages: [...] }) supplies each page's primary keyword", () => {
    const body = `<section><h2>Prices</h2><p>${'Grout costs vary. '.repeat(12)}${PROSE}</p></section>`;
    const s = site({ '/': page('/', { body }) }, [], { keywordMap: { pages: [{ url: '/', primary: 'grout cost' }], discarded: [] } });
    expect(s.result('/', 'content.keyword-stuffing')).toMatchObject({ status: 'fail' });
    expect(s.result('/', 'content.keyword-stuffing')!.msg).toContain('target "grout"');
  });

  test('no site URL in a non-indexable build checks against the template URL, https://example.com', () => {
    const noUrl = { config: { siteUrl: '', indexableEnv: 'SEO_TEST_INDEXABLE' }, factory: { project: { domain: '' } }, env: { SEO_TEST_INDEXABLE: '' } };
    const template = site({ '/': page('/', { canonical: 'https://example.com/' }) }, [], noUrl);
    expect(template.stderr).not.toContain('no site URL');
    expect(template.result('/', 'core.canonical-self')).toMatchObject({ status: 'pass' });
    // The checks still run against that URL: a canonical on another origin fails.
    const other = site({ '/': page('/') }, [], noUrl);
    expect(other.result('/', 'core.canonical-self')).toMatchObject({ status: 'fail' });
    expect(other.status).toBe(1);
  });

  test('no site URL in an indexable (production) build stops with a clear message instead of guessing', () => {
    const s = site({ '/': page('/', { canonical: 'https://example.com/' }) }, [], {
      config: { siteUrl: '', indexableEnv: 'SEO_TEST_INDEXABLE' }, factory: { project: { domain: '' } }, env: { SEO_TEST_INDEXABLE: 'true' },
    });
    expect(s.status).toBe(1);
    expect(s.stderr).toContain('no site URL');
    expect(s.stderr).toContain('project.domain');
    expect(s.report).toEqual([]);
  });

  test('core tags: a missing canonical and two H1s fail', () => {
    const s = site({ '/': page('/', { canonical: null }), '/two/': page('/two/', { body: `<h1>Second</h1><p>${PROSE}</p>` }) });
    expect(s.result('/', 'core.canonical-present')).toMatchObject({ status: 'fail' });
    expect(s.result('/two/', 'core.single-h1')).toMatchObject({ status: 'fail' });
  });

  test('links: an empty anchor, a broken internal link and a fragment that points nowhere fail', () => {
    const body = `<p>${PROSE}</p><p><a href="/guide/"></a> <a href="/missing/">Missing page</a> <a href="#nowhere">Jump</a></p>`;
    const s = site({ '/': page('/', { body }), '/guide/': page('/guide/') });
    expect(s.result('/', 'links.descriptive-anchors')).toMatchObject({ status: 'fail' });
    expect(s.result('/', 'links.broken-internal')).toMatchObject({ status: 'fail' });
    expect(s.result('/', 'links.fragment-targets')).toMatchObject({ status: 'fail' });
  });

  test('link text that runs together for crawlers fails ("Pets1" from a label and a count with no space)', () => {
    const glued = `<p>${PROSE}</p><a href="/guide/"><span>Pets</span><span class="note">1</span></a>`;
    expect(site({ '/': page('/', { body: glued }), '/guide/': page('/guide/') }).result('/', 'links.joined-anchor-text')).toMatchObject({ status: 'fail' });
    const spaced = `<p>${PROSE}</p><a href="/guide/"><span>Pets</span> <span class="note">1</span></a>`;
    expect(site({ '/': page('/', { body: spaced }), '/guide/': page('/guide/') }).result('/', 'links.joined-anchor-text')).toMatchObject({ status: 'pass' });
  });

  test('a link whose only name is an aria-label is a warning (crawlers read the text)', () => {
    const s = site({ '/': page('/', { body: `<p>${PROSE}</p><a href="/guide/" aria-label="Guide"><svg></svg></a>` }), '/guide/': page('/guide/') });
    expect(s.result('/', 'links.descriptive-anchors')).toMatchObject({ status: 'warn' });
  });

  test('security and accessibility: http resources and a table without headers fail', () => {
    const body = `<p>${PROSE}</p><img src="http://cdn.example.org/a.webp" alt="Brick wall" width="10" height="10"/><table><tr><td>a</td><td>1</td></tr></table>`;
    const s = site({ '/': page('/', { body }) });
    expect(s.result('/', 'security.mixed-content')).toMatchObject({ status: 'fail' });
    expect(s.result('/', 'accessibility.table-headers')).toMatchObject({ status: 'fail' });
  });

  test('structured data: a node without @type fails', () => {
    const s = site({ '/': page('/', { jsonld: '{"@context":"https://schema.org","@graph":[{"name":"No type"}]}' }) });
    expect(s.result('/', 'structured-data.type-present')).toMatchObject({ status: 'fail' });
  });

  test('a title under 30 characters warns, and title words must match the URL', () => {
    const s = site({ '/pets/': page('/pets/', { title: 'Pet Mortar Guides' }) });
    expect(s.result('/pets/', 'core.title-length')).toMatchObject({ status: 'warn' });
    expect(s.result('/pets/', 'url.slug-keywords')).toMatchObject({ status: 'warn' });
  });

  test('no visible disclaimer fails', () => {
    const html = page('/').replace('<p>Disclaimer: estimates only, not professional advice.</p>', '');
    expect(site({ '/': html }).result('/', 'eeat.disclaimers')).toMatchObject({ status: 'fail' });
  });

  test('an exception turns a result into "accepted" and keeps its reason; nothing else silences a check', () => {
    // A big inline payload, like a framework's page data, pushes the text-to-HTML ratio under 10%.
    const heavy = page('/', { extraHead: `<script>self.data="${'x'.repeat(40_000)}"</script>` });
    const plain = site({ '/': heavy });
    expect(plain.result('/', 'content.text-html-ratio')).toMatchObject({ status: 'warn' });
    const excepted = site({ '/': heavy }, [{ check: 'content.text-html-ratio', pages: '*', reason: 'framework payload', reviewed: '2026-10-25' }]);
    expect(excepted.result('/', 'content.text-html-ratio')).toMatchObject({ status: 'accepted' });
    expect(excepted.result('/', 'content.text-html-ratio')!.msg).toContain('framework payload');
  });
});
