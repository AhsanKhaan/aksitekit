// The output check (scripts/check-out.mjs) on a planted site: it passes clean, and fails on each broken rule.
import { describe, expect, it } from 'vitest';
import { checkSite } from '../../scripts/check-out.mjs';
import { ORIGIN, pageHtml, site, withPage } from './site-fixture';

const run = (s: ReturnType<typeof site>, opts: { adsEnabled?: boolean; production?: boolean } = {}) => checkSite({ ...s, origin: ORIGIN, ...opts }).problems as string[];
const all = ['/', '/a/', '/b/', '/c/', '/about/', '/contact/', '/privacy/', '/terms/', '/editorial-policy/', '/authors/someone/'];

describe('check-out', () => {
  it('passes a clean site', () => {
    expect(run(site())).toEqual([]);
  });

  it('fails a duplicate title or description', () => {
    const s = withPage(site(), '/b/', pageHtml('/b/', { title: 'Title of /a/ for the fixture', links: all }));
    expect(run(s)).toEqual([expect.stringMatching(/^\/b\/: same title as \/a\//)]);
  });

  it('fails two H1s, a missing canonical or a canonical pointing elsewhere', () => {
    const twoH1 = pageHtml('/a/', { links: all, body: '<h1>Second</h1>' });
    expect(run(withPage(site(), '/a/', twoH1))).toEqual([expect.stringMatching(/\/a\/: 2 <h1> tags/)]);
    const elsewhere = pageHtml('/a/', { links: all }).replace(`${ORIGIN}/a/"`, `${ORIGIN}/"`);
    expect(run(withPage(site(), '/a/', elsewhere))).toEqual([expect.stringMatching(/canonical https:\/\/example\.com\/ is not https:\/\/example\.com\/a\//)]);
  });

  it('fails an og:image that is not in the output', () => {
    const s = site();
    s.files.delete('og/a/image.png');
    expect(run(s)).toEqual([expect.stringMatching(/\/a\/: og:image .* is not an image file in the output/)]);
  });

  it('fails a page with fewer than 3 inbound links (planted: an orphan reachable only from home)', () => {
    let s = site();
    for (const r of all.filter((x) => x !== '/' && x !== '/c/')) s = withPage(s, r, pageHtml(r, { links: all.filter((x) => x !== r && x !== '/c/') }));
    expect(run(s)).toEqual([expect.stringMatching(/\/c\/: 1 inbound internal link/)]);
  });

  it('fails a page more than 3 clicks from home', () => {
    const chain = ['/', '/d1/', '/d1/d2/', '/d1/d2/d3/', '/d1/d2/d3/d4/'];
    const s = site(chain);
    const linkNext = (i: number) => [chain[i + 1], chain[i - 1]].filter(Boolean) as string[];
    let t = s;
    chain.forEach((r, i) => (t = withPage(t, r, pageHtml(r, { links: linkNext(i) }))));
    expect(run(t).join('\n')).toMatch(/\/d1\/d2\/d3\/d4\/: 4 clicks from home \(max 3\)/);
  });

  it('fails a broken internal link', () => {
    const s = withPage(site(), '/a/', pageHtml('/a/', { links: [...all, '/missing/'] }));
    expect(run(s)).toEqual([expect.stringMatching(/\/a\/: broken internal link \/missing\//)]);
  });

  it('fails when the sitemap or llms.txt disagree with the pages', () => {
    const s = site();
    s.files.set('sitemap.xml', `<url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/gone/</loc></url>`);
    s.files.set('llms.txt', 'Example Site\n');
    const text = run(s).join('\n');
    expect(text).toMatch(/\/a\/: not in sitemap\.xml/);
    expect(text).toMatch(/sitemap\.xml lists https:\/\/example\.com\/gone\/, which has no page/);
    expect(text).toMatch(/llms\.txt must start with "# <site name>"/);
  });

  it('fails ad code or ads.txt while AdSense is off (planted: an AdSense script tag)', () => {
    const s = withPage(site(), '/a/', pageHtml('/a/', { links: all, extraHead: '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>' }));
    s.files.set('ads.txt', 'google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0');
    const text = run(s).join('\n');
    expect(text).toMatch(/ads\.txt exists, but AdSense is off/);
    expect(text).toMatch(/a\/index\.html: ad code/);
    expect(run(s, { adsEnabled: true })).toEqual([]);
  });

  it('fails an example page in a production build only', () => {
    const s = withPage(site(), '/a/', pageHtml('/a/', { links: all, body: '<aside data-example-page="">Example</aside>' }));
    expect(run(s)).toEqual([]);
    expect(run(s, { production: true })).toEqual([expect.stringMatching(/\/a\/: a template example page in a production build/)]);
  });

  it('fails a hidden file in the output, but not .well-known/ (planted: .gitkeep, .DS_Store, .env)', () => {
    const s = site();
    s.files.set('.gitkeep', '');
    s.files.set('og/.DS_Store', '');
    s.files.set('.env', '');
    expect(run(s)).toEqual([
      '.gitkeep: a hidden file in the output folder (only .well-known/ is published)',
      'og/.DS_Store: a hidden file in the output folder (only .well-known/ is published)',
      '.env: a hidden file in the output folder (only .well-known/ is published)',
    ]);
    expect(run(site()).join('\n')).not.toMatch(/\.well-known/);
  });

  it('fails without the required files', () => {
    const s = site();
    s.files.delete('.well-known/security.txt');
    s.files.delete('robots.txt');
    expect(run(s)).toEqual(['missing robots.txt in the output folder', 'missing .well-known/security.txt in the output folder']);
  });
});
