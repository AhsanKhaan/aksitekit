// gate:adsense (scripts/adsense-gate.mjs) on a planted site: trust pages, no ads before approval, the full ad setup
// after it, placeholders, example pages, content floors and policy terms.
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../scripts/adsense-gate.mjs';
import { ORIGIN, pageHtml, site, withPage } from './site-fixture';

const words = (n: number) => `<p>${Array.from({ length: n }, (_, i) => `word${i % 50}`).join(' ')}</p>`;
const rich = () => site(undefined, () => words(850));
const off = { monetization: { adsense: { enabled: false, publisherId: '' } } };
const PUB = 'pub-1234567890123456';
const on = { monetization: { adsense: { enabled: true, publisherId: PUB, cmp: 'Google Privacy & messaging' } } };
const run = (s: ReturnType<typeof site>, cfg: object = off, types = new Map<string, string>()) => evaluate({ ...s, cfg, origin: ORIGIN, types }) as { failures: string[]; notes: string[] };
const all = ['/', '/a/', '/b/', '/c/', '/about/', '/contact/', '/privacy/', '/terms/', '/editorial-policy/', '/authors/someone/'];

describe('gate:adsense', () => {
  it('passes a complete site with AdSense off, and says what comes next', () => {
    const r = run(rich());
    expect(r.failures).toEqual([]);
    expect(r.notes.join('\n')).toMatch(/certified CMP/);
  });

  it('fails a missing trust page or author page', () => {
    const s = site(['/', '/a/', '/b/', '/c/', '/about/', '/contact/', '/privacy/', '/terms/'], () => words(850));
    const text = run(s).failures.join('\n');
    expect(text).toMatch(/required page \/editorial-policy\/ is missing/);
    expect(text).toMatch(/no author page under \/authors\//);
  });

  it('fails a page whose footer leaves out a trust page', () => {
    const s = withPage(rich(), '/a/', pageHtml('/a/', { links: all.filter((r) => r !== '/terms/' && r !== '/a/'), body: words(850) }));
    expect(run(s).failures).toEqual([expect.stringMatching(/^\/a\/: no link to \/terms\//)]);
  });

  it('fails ads.txt or ad code before approval (planted)', () => {
    const s = withPage(rich(), '/b/', pageHtml('/b/', { links: all, body: `${words(850)}<ins class="adsbygoogle"></ins>` }));
    s.files.set('ads.txt', `google.com, ${PUB}, DIRECT, f08c47fec0942fa0`);
    const text = run(s).failures.join('\n');
    expect(text).toMatch(/ads\.txt exists before AdSense is switched on/);
    expect(text).toMatch(/ad code before AdSense is switched on: b\/index\.html/);
  });

  it('wants the full setup once switched on: ads.txt line, a CMP, an advertising section and CSP hosts', () => {
    const text = run(rich(), { monetization: { adsense: { enabled: true, publisherId: PUB } } }).failures.join('\n');
    expect(text).toMatch(/ads\.txt must contain "google\.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0"/);
    expect(text).toMatch(/monetization\.adsense\.cmp is empty/);
    expect(text).toMatch(/\/privacy\/ doesn't describe advertising cookies/);
    expect(text).toMatch(/the CSP doesn't allow the AdSense hosts/);
    const ready = withPage(rich(), '/privacy/', pageHtml('/privacy/', { links: all, body: `${words(850)}<p>Advertising cookies are set by Google.</p>` }));
    ready.files.set('ads.txt', `google.com, ${PUB}, DIRECT, f08c47fec0942fa0\n`);
    ready.files.set('_headers', '/*\n  Content-Security-Policy: script-src https://pagead2.googlesyndication.com');
    expect(run(ready, on).failures).toEqual([]);
    expect(run(ready, { monetization: { adsense: { ...on.monetization.adsense, publisherId: 'pub-1' } } }).failures).toEqual([expect.stringMatching(/publisherId must be "pub-" and 16 digits/)]);
  });

  it('fails placeholder text and template example pages', () => {
    let s = withPage(rich(), '/a/', pageHtml('/a/', { links: all, body: `${words(850)}<p>More pages coming soon.</p>` }));
    s = withPage(s, '/b/', pageHtml('/b/', { links: all, body: `${words(850)}<aside data-example-page="">Example page.</aside>` }));
    const text = run(s).failures.join('\n');
    expect(text).toMatch(/\/a\/: placeholder text "coming soon"/);
    expect(text).toMatch(/\/b\/: a template example page/);
  });

  it('fails a page under its floor, judged by its keyword-map type (planted: a 400-word guide)', () => {
    const s = withPage(rich(), '/a/', pageHtml('/a/', { links: all, body: words(400) }));
    expect(run(s, off, new Map([['/a/', 'hub']])).failures).toEqual([]);
    expect(run(s, off, new Map([['/a/', 'guide']])).failures).toEqual([expect.stringMatching(/\/a\/: \d+ words in <main>, under the guide floor of 800/)]);
  });

  it('fails restricted topics unless the owner recorded an exception, and any request to click ads', () => {
    const s = withPage(rich(), '/a/', pageHtml('/a/', { links: all, body: `${words(850)}<p>Compare online slots here. Please click on our ads.</p>` }));
    const text = run(s).failures.join('\n');
    expect(text).toMatch(/"online slots" \(gambling\) is restricted/);
    expect(text).toMatch(/"click on our ads" asks visitors to click ads/);
    const excepted = { monetization: { adsense: { enabled: false, policyExceptions: [{ route: '/a/', term: 'online slots', reason: 'A page on the maths of slot odds, reviewed', reviewed: '2026-10-29' }] } } };
    expect(run(s, excepted).failures).toEqual([expect.stringMatching(/asks visitors to click ads/)]);
  });

  it('notes your-money-or-your-life topics for the owner', () => {
    const s = withPage(rich(), '/c/', pageHtml('/c/', { links: all, body: `${words(850)}<p>How mortgages work.</p>` }));
    expect(run(s).notes.join('\n')).toMatch(/\/c\/: a your-money-or-your-life topic \("mortgages"\)/);
  });
});
