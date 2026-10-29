import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mapRowSchema, pageContentSchema, type MapRow, type PageContent } from '@/lib/content/schema';

/**
 * The content registry (docs/TODO-step-c.md §1): every page the site builds, read at build time.
 * - research/out/keyword-map.json (the keyword stage) decides which URLs exist and what each one targets; until it
 *   exists, the template's example map in content/examples/ stands in.
 * - content/pages/<slug>.json holds each page's text. A mapped URL without a content file isn't built yet; a content
 *   file without a mapped URL is an error, so no page ships that the research didn't ask for.
 * Any rule broken here throws, which fails the build with the reason.
 */
export const KEYWORD_MAP = 'research/out/keyword-map.json';
export const EXAMPLE_MAP = 'content/examples/keyword-map.json';
export const CONTENT_DIR = 'content/pages';
/** Top-level routes the app owns; a category can't take one of these names. */
export const RESERVED = ['about', 'contact', 'privacy', 'terms', 'editorial-policy', 'authors', 'og'];

/** The file name for a URL: "/a/b/" → "a--b", "/" → "home" (the same rule as the briefs in research/out/briefs/). */
export const slugOf = (url: string): string => url.replace(/^\/+|\/+$/g, '').replace(/\//g, '--') || 'home';

export interface Page extends PageContent {
  row?: MapRow;
  category: string;
  parent?: string;
}

export interface Registry {
  usingExampleMap: boolean;
  map: MapRow[];
  home: Page;
  categories: Page[];
  pages: Page[];
  byUrl: Map<string, Page>;
  unbuilt: MapRow[];
}

const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** Builds and checks the registry from a root folder (tests pass a planted one). */
export function loadRegistry(root = process.cwd()): Registry {
  const problems: string[] = [];
  const mapFile = existsSync(join(root, KEYWORD_MAP)) ? KEYWORD_MAP : EXAMPLE_MAP;
  const rawMap = read(join(root, mapFile)) as unknown;
  const rows = (Array.isArray(rawMap) ? rawMap : ((rawMap as { pages?: unknown[] }).pages ?? [])).map((r, i) => {
    const parsed = mapRowSchema.safeParse(r);
    if (!parsed.success) problems.push(`${mapFile} → pages[${i}]: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
    return parsed.success ? parsed.data : null;
  }).filter((r): r is MapRow => r !== null);
  const rowByUrl = new Map(rows.map((r) => [r.url, r]));

  const contentDir = join(root, CONTENT_DIR);
  const contents: PageContent[] = [];
  for (const file of existsSync(contentDir) ? readdirSync(contentDir).filter((f) => f.endsWith('.json')).sort() : []) {
    const parsed = pageContentSchema.safeParse(read(join(contentDir, file)));
    if (!parsed.success) {
      problems.push(`${CONTENT_DIR}/${file}: ${parsed.error.issues.map((x) => `${x.path.join('.') || '(file)'}: ${x.message}`).join('; ')}`);
      continue;
    }
    if (`${slugOf(parsed.data.url)}.json` !== file) problems.push(`${CONTENT_DIR}/${file}: its url ${parsed.data.url} belongs in ${slugOf(parsed.data.url)}.json`);
    contents.push(parsed.data);
  }

  const pages: Page[] = [];
  const categories: Page[] = [];
  let home: Page | undefined;
  for (const c of contents) {
    const segs = c.url.split('/').filter(Boolean);
    if (c.kind === 'home') {
      if (c.url !== '/') problems.push(`${c.url}: kind "home" is only for /`);
      home = { ...c, category: '' };
    } else if (c.kind === 'category') {
      if (segs.length !== 1) problems.push(`${c.url}: a category page is /{category}/`);
      if (RESERVED.includes(segs[0] ?? '')) problems.push(`${c.url}: "${segs[0]}" is a reserved route`);
      categories.push({ ...c, category: segs[0] ?? '' });
    } else {
      const row = rowByUrl.get(c.url);
      if (!row) problems.push(`${c.url}: content file but no keyword-map row (${mapFile}); every page needs a researched URL`);
      else if (row.type !== c.kind) problems.push(`${c.url}: content kind "${c.kind}" but the keyword map says "${row.type}"`);
      if (segs.length < 2) problems.push(`${c.url}: a ${c.kind} page is /{category}/{slug}/ or /{category}/{slug}/{child}/`);
      pages.push({ ...c, row, category: segs[0] ?? '', parent: segs.length === 3 ? `/${segs[0]}/${segs[1]}/` : undefined });
    }
  }
  if (!home) problems.push(`${CONTENT_DIR}/home.json is missing (the home page)`);
  const byUrl = new Map<string, Page>([...(home ? [home] : []), ...categories, ...pages].map((p) => [p.url, p]));
  for (const p of pages) {
    if (p.parent && !byUrl.has(p.parent)) problems.push(`${p.url}: its parent ${p.parent} has no content file, so the child would be an orphan`);
    if (!categories.some((c) => c.category === p.category)) problems.push(`${p.url}: category /${p.category}/ has no content file (${CONTENT_DIR}/${p.category}.json)`);
    if (p.kind === 'tool' && !p.tool) problems.push(`${p.url}: a tool page names its component in "tool"`);
  }
  for (const c of categories) if (!pages.some((p) => p.category === c.category)) problems.push(`${c.url}: a category page with no pages under it`);
  if (problems.length) throw new Error(`content registry: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);

  const order = (a: Page, b: Page) => a.url.localeCompare(b.url);
  return {
    usingExampleMap: mapFile === EXAMPLE_MAP,
    map: rows,
    home: home!,
    categories: categories.sort(order),
    pages: pages.sort(order),
    byUrl,
    unbuilt: rows.filter((r) => !byUrl.has(r.url)),
  };
}

let cached: Registry | undefined;
/** The registry of this checkout, loaded once per build. */
export const registry = (): Registry => (cached ??= loadRegistry());

export const topLevel = (r: Registry, category: string) => r.pages.filter((p) => p.category === category && !p.parent);
export const childrenOf = (r: Registry, url: string) => r.pages.filter((p) => p.parent === url);

/** Breadcrumbs mirror the URL: Home › Category › Page › Child. */
export function breadcrumbs(r: Registry, url: string): { name: string; path: string }[] {
  const segs = url.split('/').filter(Boolean);
  const trail = [{ name: 'Home', path: '/' }];
  for (let i = 1; i <= segs.length; i++) {
    const path = `/${segs.slice(0, i).join('/')}/`;
    const p = r.byUrl.get(path);
    if (p) trail.push({ name: p.name, path });
  }
  return trail;
}

/** Other pages in the same category (not the page itself, its parent or its children), for "Related" links. */
export function related(r: Registry, page: Page, max = 4): Page[] {
  return r.pages.filter((p) => p.category === page.category && p.url !== page.url && p.url !== page.parent && p.parent !== page.url).slice(0, max);
}
