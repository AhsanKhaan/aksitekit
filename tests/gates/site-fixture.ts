// A small built site in memory, shaped like the output folder the gates read: every page links to every other, so
// each has 3+ inbound links and sits 1 click from home. Tests change one thing to plant a failure.
export const ORIGIN = 'https://example.com';
export const TRUST = ['/about/', '/contact/', '/privacy/', '/terms/', '/editorial-policy/'];

export interface FixturePage {
  route: string;
  html: string;
  notFound?: boolean;
}

export function pageHtml(route: string, { title = `Title of ${route} for the fixture`, description = `A description of ${route} for the gate fixture.`, links = [] as string[], body = '', robots = 'noindex, nofollow', extraHead = '' } = {}) {
  return [
    '<!doctype html><html lang="en"><head>',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${ORIGIN}${route}">`,
    `<meta property="og:image" content="${ORIGIN}/og${route}image.png">`,
    '<link rel="icon" href="/icon.svg">',
    extraHead,
    '</head><body><header><nav>',
    ...links.map((l) => `<a href="${l}">Link to ${l}</a>`),
    '</nav></header>',
    `<main><h1>Heading of ${route}</h1>${body}</main>`,
    '</body></html>',
  ].join('');
}

/** The routes, their pages and the files around them (sitemap, llms.txt, required files, OG images). */
export function site(routes = ['/', '/a/', '/b/', '/c/', ...TRUST, '/authors/someone/'], body: (route: string) => string = () => '<p>Text.</p>') {
  const pages: FixturePage[] = routes.map((r) => ({ route: r, html: pageHtml(r, { links: routes.filter((x) => x !== r), body: body(r) }) }));
  pages.push({ route: '/404.html', html: pageHtml('/404.html', { links: ['/'] }), notFound: true });
  const files = new Map<string, string>();
  for (const f of ['robots.txt', '_headers', '404.html', 'favicon.ico', '.well-known/security.txt', 'icon.svg']) files.set(f, '');
  files.set('sitemap.xml', routes.map((r) => `<url><loc>${ORIGIN}${r}</loc></url>`).join('\n'));
  files.set('llms.txt', `# Example Site\n\n${routes.map((r) => `- [Page](${ORIGIN}${r})`).join('\n')}\n`);
  for (const r of routes) files.set(`og${r}image.png`, '');
  for (const p of pages) if (!p.notFound) files.set(p.route === '/' ? 'index.html' : `${p.route.slice(1)}index.html`, p.html);
  return { pages, files };
}

/** Replace one page's HTML (and its copy in files). */
export function withPage(s: ReturnType<typeof site>, route: string, html: string) {
  const pages = s.pages.map((p) => (p.route === route ? { ...p, html } : p));
  const files = new Map(s.files);
  files.set(route === '/' ? 'index.html' : `${route.slice(1)}index.html`, html);
  return { pages, files };
}
