// The generated public files (scripts/lib/public-files.mjs): robots policy, CSP and headers, security.txt, and the
// sitemap and llms.txt built from the pages. Each rule has a planted case that must fail.
import { describe, expect, it } from 'vitest';
import {
  AI_SEARCH_BOTS, AI_TRAINING_BOTS, ADSENSE_BOTS, SEARCH_BOTS, blocksSite, botPolicyProblems, csp, headersFile, hstsValue,
  llmsTxt, publishedPages, robotsGroups, robotsTxt, securityTxt, sitemapXml,
} from '../../scripts/lib/public-files.mjs';

const SITE = 'https://example.com';
const allow = { search: 'allow', adsense: 'allow', aiSearch: 'allow', aiTraining: 'allow' };

describe('robots.txt', () => {
  const groups = (bots: Record<string, string>) => robotsGroups(robotsTxt({ name: 'Example Site', bots, siteUrl: SITE }));

  it('gives every named crawler its own group, Mediapartners-Google included (it ignores "*")', () => {
    const g = groups(allow);
    for (const ua of [...SEARCH_BOTS, ...ADSENSE_BOTS, ...AI_SEARCH_BOTS, ...AI_TRAINING_BOTS]) {
      expect(g.some((x) => x.agents.includes(ua.toLowerCase())), ua).toBe(true);
      expect(blocksSite(g, ua), ua).toBe(false);
    }
    expect(robotsTxt({ name: 'Example Site', bots: allow, siteUrl: SITE })).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it('shuts out training crawlers only, when bots.aiTraining is "block"', () => {
    const g = groups({ ...allow, aiTraining: 'block' });
    for (const ua of AI_TRAINING_BOTS) expect(blocksSite(g, ua), ua).toBe(true);
    for (const ua of [...SEARCH_BOTS, ...ADSENSE_BOTS, ...AI_SEARCH_BOTS, '*']) expect(blocksSite(g, ua), ua).toBe(false);
  });

  it('leaves an undecided training policy to "*" (and the production gate fails it)', () => {
    const text = robotsTxt({ name: 'Example Site', bots: { ...allow, aiTraining: 'ask' }, siteUrl: SITE });
    expect(text).not.toMatch(/User-agent: GPTBot/);
    expect(botPolicyProblems({ ...allow, aiTraining: 'ask' })).toEqual([expect.stringMatching(/bots\.aiTraining is "ask"/)]);
  });

  it('flags a policy that removes the site from search (planted: bots.search "block")', () => {
    expect(botPolicyProblems({ ...allow, search: 'block' })).toEqual([expect.stringMatching(/removes the site from Google and Bing/)]);
    expect(blocksSite(groups({ ...allow, search: 'block' }), 'Googlebot')).toBe(true);
    expect(botPolicyProblems(allow)).toEqual([]);
  });

  it('reads CRLF files and the most specific group first', () => {
    const g = robotsGroups('User-agent: *\r\nDisallow: /\r\n\r\nUser-agent: Googlebot\r\nAllow: /\r\n');
    expect(blocksSite(g, 'Googlebot')).toBe(false);
    expect(blocksSite(g, 'Bingbot')).toBe(true);
  });
});

describe('_headers and the CSP', () => {
  it('locks the page down by default', () => {
    const c = csp();
    for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) expect(c).toContain(d);
    expect(c).not.toMatch(/'unsafe-eval'|googletagmanager|googlesyndication/);
  });

  it('allow-lists third parties only when the build turns them on', () => {
    expect(csp({ analytics: true })).toMatch(/googletagmanager\.com/);
    expect(csp({ ads: true })).toMatch(/googlesyndication\.com/);
  });

  it('sends noindex on every non-indexable build and on preview hosts, HSTS on the real domain only', () => {
    const preview = headersFile({ siteUrl: SITE });
    expect(preview).toMatch(/^\/\*\n(?:.*\n)*? {2}X-Robots-Tag: noindex, nofollow$/m);
    expect(preview).toMatch(/https:\/\/:project\.pages\.dev\/\*\n {2}X-Robots-Tag: noindex/);
    expect(preview).toMatch(/https:\/\/example\.com\/\*\n {2}Strict-Transport-Security: max-age=86400/);
    expect(preview.match(/Strict-Transport-Security/g)).toHaveLength(1);
    const live = headersFile({ siteUrl: SITE, indexable: true });
    expect(live.split('https://')[0]).not.toMatch(/X-Robots-Tag/);
    for (const h of ['X-Content-Type-Options: nosniff', 'Referrer-Policy:', 'Permissions-Policy:', 'Cross-Origin-Opener-Policy: same-origin']) expect(live).toContain(h);
  });

  it('names Workers preview hosts on a Workers target', () => {
    expect(headersFile({ siteUrl: SITE, target: 'cloudflare-workers' })).toContain('https://:project.:account.workers.dev/*');
  });

  it('refuses HSTS preload and malformed values (planted)', () => {
    expect(() => hstsValue('max-age=63072000; includeSubDomains; preload')).toThrow(/never preload/);
    expect(() => hstsValue('max-age=abc')).toThrow();
    expect(hstsValue('max-age=31536000; includeSubDomains')).toBe('max-age=31536000; includeSubDomains');
  });
});

describe('security.txt', () => {
  it('has a contact, a canonical URL and an expiry under a year', () => {
    const now = new Date('2026-10-29T00:00:00Z');
    const t = securityTxt({ siteUrl: SITE, email: 'security@example.com', now });
    expect(t).toContain('Contact: mailto:security@example.com');
    expect(t).toContain(`Canonical: ${SITE}/.well-known/security.txt`);
    const expires = Date.parse(t.match(/Expires: (\S+)/)![1]!);
    expect(expires - now.getTime()).toBeLessThan(365 * 86_400_000);
  });
});

describe('sitemap.xml and llms.txt', () => {
  const html = ({ title, robots = 'noindex, nofollow', trust = false, modified = '' }: { title: string; robots?: string; trust?: boolean; modified?: string }) =>
    `<html><head><title>${title}</title><meta name="description" content="About ${title}"><meta name="robots" content="${robots}">` +
    `${modified ? `<script type="application/ld+json">{"dateModified":"${modified}"}</script>` : ''}</head>` +
    `<body><main${trust ? ' data-trust-page=""' : ''}><h1>${title}</h1><p>Words.</p></main></body></html>`;
  const pages = [
    { route: '/', html: html({ title: 'Home' }) },
    { route: '/handbook/', html: html({ title: 'Handbook', modified: '2026-10-29' }) },
    { route: '/handbook/tool/', html: html({ title: 'Tool' }) },
    { route: '/about/', html: html({ title: 'About', trust: true }) },
    { route: '/held/', html: html({ title: 'Held', robots: 'noindex, follow' }) },
    { route: '/404.html', html: html({ title: 'Not found' }), notFound: true },
  ];
  const published = publishedPages(pages, SITE);

  it('lists built pages only: never the 404 page or a page held with "noindex, follow"', () => {
    expect(published.map((p: { route: string }) => p.route)).toEqual(['/', '/about/', '/handbook/', '/handbook/tool/']);
    const xml = sitemapXml(published);
    expect(xml).toContain(`<loc>${SITE}/handbook/</loc><lastmod>2026-10-29</lastmod>`);
    expect(xml).not.toMatch(/held|404/);
  });

  it('writes llms.txt starting with "# <site name>", trust pages under Optional', () => {
    const t = llmsTxt({ name: 'Example Site', published });
    expect(t.startsWith('# Example Site\n')).toBe(true);
    expect(t).toContain(`- [Tool](${SITE}/handbook/tool/): About Tool`);
    expect(t.split('## Optional')[1]).toContain(`(${SITE}/about/)`);
    expect(t).not.toContain('/held/');
  });
});
