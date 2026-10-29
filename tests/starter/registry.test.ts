// The content registry (lib/registry.ts): the template's own example content loads, and each rule fails on a planted
// case. Planted content lives in temporary folders; the repo's content is only read.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { breadcrumbs, childrenOf, loadRegistry, related, slugOf } from '@/lib/registry';

const REPO = path.resolve(__dirname, '..', '..');
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A copy of the template's example map and content, to plant one problem in. */
function plantedRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'registry-'));
  temps.push(root);
  cpSync(path.join(REPO, 'content'), path.join(root, 'content'), { recursive: true });
  return root;
}
const writePage = (root: string, slug: string, data: unknown) => writeFileSync(path.join(root, 'content', 'pages', `${slug}.json`), JSON.stringify(data));
const page = (over: Record<string, unknown>) => ({
  url: '/handbook/extra-page/',
  kind: 'guide',
  name: 'Extra page',
  title: 'An extra guide page with a title of fair length',
  description: 'A planted page for the registry tests, with a description long enough to pass the schema rules.',
  h1: 'Extra page',
  updated: '2026-10-29',
  intro: ['Planted text.'],
  ...over,
});

describe('the template registry', () => {
  const r = loadRegistry(REPO);

  it('loads the example map and one page of each type', () => {
    expect(r.usingExampleMap).toBe(true);
    expect(r.home.url).toBe('/');
    expect(r.categories.map((c) => c.url)).toEqual(['/handbook/']);
    expect(r.pages.map((p) => p.kind).sort()).toEqual(['guide', 'hub', 'instance', 'tool']);
    expect(r.unbuilt).toEqual([]);
  });

  it('keeps every URL lowercase, slashed and at most 3 levels deep', () => {
    for (const url of r.byUrl.keys()) expect(url).toMatch(/^\/(?:[a-z0-9-]+\/){0,3}$/);
  });

  it('builds breadcrumbs that mirror the URL', () => {
    expect(breadcrumbs(r, '/handbook/length-checker/sample-title/').map((t) => t.path)).toEqual(['/', '/handbook/', '/handbook/length-checker/', '/handbook/length-checker/sample-title/']);
  });

  it('links children to their parent and keeps related pages out of the parent-child line', () => {
    expect(childrenOf(r, '/handbook/length-checker/').map((p) => p.url)).toEqual(['/handbook/length-checker/sample-title/']);
    const tool = r.byUrl.get('/handbook/length-checker/')!;
    expect(related(r, tool as never).map((p) => p.url)).not.toContain('/handbook/length-checker/sample-title/');
  });

  it('names files after the URL', () => {
    expect(slugOf('/')).toBe('home');
    expect(slugOf('/a/b/c/')).toBe('a--b--c');
  });
});

describe('planted registry failures', () => {
  it('fails a content file whose URL has no keyword-map row', () => {
    const root = plantedRoot();
    writePage(root, 'handbook--extra-page', page({}));
    expect(() => loadRegistry(root)).toThrow(/\/handbook\/extra-page\/: content file but no keyword-map row/);
  });

  it('fails a content file named after another URL', () => {
    const root = plantedRoot();
    writePage(root, 'wrong-name', page({ url: '/handbook/length-checker/' }));
    expect(() => loadRegistry(root)).toThrow(/wrong-name\.json: its url \/handbook\/length-checker\/ belongs in handbook--length-checker\.json/);
  });

  it('fails a kind that disagrees with the keyword map', () => {
    const root = plantedRoot();
    writePage(root, 'handbook--page-anatomy', page({ url: '/handbook/page-anatomy/', kind: 'guide' }));
    expect(() => loadRegistry(root)).toThrow(/content kind "guide" but the keyword map says "hub"/);
  });

  it('fails a title outside 30-60 characters before any page is built', () => {
    const root = plantedRoot();
    writePage(root, 'handbook--page-anatomy', page({ url: '/handbook/page-anatomy/', kind: 'hub', title: 'Too short' }));
    expect(() => loadRegistry(root)).toThrow(/handbook--page-anatomy\.json: title/);
  });

  it('fails a child whose parent has no content file (an orphan)', () => {
    const root = plantedRoot();
    rmSync(path.join(root, 'content', 'pages', 'handbook--page-anatomy.json'));
    expect(() => loadRegistry(root)).toThrow(/its parent \/handbook\/page-anatomy\/ has no content file/);
  });

  it('fails a category that takes a reserved route', () => {
    const root = plantedRoot();
    writePage(root, 'about', page({ url: '/about/', kind: 'category' }));
    expect(() => loadRegistry(root)).toThrow(/"about" is a reserved route/);
  });

  it('fails without a home page', () => {
    const root = plantedRoot();
    rmSync(path.join(root, 'content', 'pages', 'home.json'));
    expect(() => loadRegistry(root)).toThrow(/home\.json is missing/);
  });

  it('fails a tool page that names no tool component', () => {
    const root = plantedRoot();
    writePage(root, 'handbook--length-checker', page({ url: '/handbook/length-checker/', kind: 'tool' }));
    expect(() => loadRegistry(root)).toThrow(/a tool page names its component in "tool"/);
  });

  it('prefers the research keyword map over the example once it exists', () => {
    const root = plantedRoot();
    mkdirSync(path.join(root, 'research', 'out'), { recursive: true });
    writeFileSync(path.join(root, 'research', 'out', 'keyword-map.json'), JSON.stringify({ pages: [] }));
    expect(() => loadRegistry(root)).toThrow(/no keyword-map row \(research\/out\/keyword-map\.json\)/);
  });
});
