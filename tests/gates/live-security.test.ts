// check:live (scripts/check-live.mjs) and check:security (scripts/check-security.mjs): every rule on planted
// responses, DNS answers and output files. Nothing here touches the network.
// Fake secrets are built by concatenation so this file itself holds none.
import { describe, expect, it } from 'vitest';
import { caaProblems, dnssecProblems, hstsProblems, nelProblems, robotsProblems } from '../../scripts/check-live.mjs';
import {
  burstProblems, cdnProblem, checkTarget, cspAllows, cspProblems, csrfProblem, emailProblems, headerLeaks, inRanges,
  resourcesOutsideCsp, scanOutput, traversalProblem, unproxiedRecords, xssEchoed, XSS_PAYLOADS,
} from '../../scripts/check-security.mjs';
import { csp, robotsTxt } from '../../scripts/lib/public-files.mjs';

const SITE = 'https://example-site.test';
const cfg = { project: { name: 'example-site', domain: 'example-site.test' } };

describe('check:live', () => {
  it('wants exactly one HSTS value with max-age, never preload', () => {
    expect(hstsProblems('max-age=86400')).toEqual([]);
    expect(hstsProblems('')).toEqual([expect.stringMatching(/no Strict-Transport-Security/)]);
    expect(hstsProblems('max-age=86400, max-age=31536000')).toEqual([expect.stringMatching(/two HSTS values/)]);
    expect(hstsProblems('max-age=31536000; preload')).toEqual([expect.stringMatching(/never preload/)]);
  });

  it('wants CAA to allow only the host certificate authorities (planted: a stray CA)', () => {
    const cf = ['0 issue "letsencrypt.org"', '0 issue "pki.goog; cansignhttpexchanges=yes"', '0 issuewild "ssl.com"'];
    expect(caaProblems(cf, 'cloudflare-pages')).toEqual([]);
    expect(caaProblems([], 'cloudflare-pages')).toEqual([expect.stringMatching(/no CAA record/)]);
    expect(caaProblems([...cf, '0 issue "rogue-ca.example"'], 'cloudflare-pages')).toEqual([expect.stringMatching(/allows rogue-ca\.example/)]);
    expect(caaProblems(['0 issue "letsencrypt.org"'], 'cloudflare-pages')).toEqual([expect.stringMatching(/doesn't allow pki\.goog/)]);
  });

  it('wants DNSSEC to validate and no NEL headers', () => {
    expect(dnssecProblems({ Status: 0, AD: true })).toEqual([]);
    expect(dnssecProblems({ Status: 0, AD: false })).toHaveLength(1);
    expect(nelProblems({ nel: '{"report_to":"cf-nel"}' })).toHaveLength(1);
    expect(nelProblems({})).toEqual([]);
  });

  it('wants our robots.txt, open to search, pointing to the sitemap (planted: managed file, blocked search)', () => {
    const bots = { search: 'allow', adsense: 'allow', aiSearch: 'allow', aiTraining: 'block' };
    expect(robotsProblems(robotsTxt({ name: 'X', bots, siteUrl: SITE }), SITE, bots)).toEqual([]);
    const blocked = robotsProblems('User-agent: *\nDisallow: /\n# Content-Signal: search=yes\n', SITE, bots).join('\n');
    expect(blocked).toMatch(/shuts out Googlebot, Bingbot, \*/);
    expect(blocked).toMatch(/doesn't point to/);
    expect(blocked).toMatch(/Cloudflare's managed file/);
  });
});

describe('check:security: targets', () => {
  it('probes only the project\'s own hosts', () => {
    expect(checkTarget(`${SITE}/x`, cfg, {})).toBe(SITE);
    expect(checkTarget('https://www.example-site.test', cfg, {})).toBe('https://www.example-site.test');
    expect(checkTarget('https://abc123.example-site.pages.dev', cfg, {})).toBe('https://abc123.example-site.pages.dev');
    expect(() => checkTarget('https://someone-else.test', cfg, {})).toThrow(/not one of this project's hosts/);
    expect(() => checkTarget('http://example-site.test', cfg, {})).toThrow(/must be https/);
    expect(() => checkTarget('https://user:pw@example-site.test', cfg, {})).toThrow(/credentials/);
    expect(checkTarget('http://localhost:4321', cfg, {}, { local: true })).toBe('http://localhost:4321');
    expect(() => checkTarget('http://10.0.0.5', cfg, {}, { local: true })).toThrow(/localhost only/);
  });
});

describe('check:security: the output folder', () => {
  const fakeKey = 'AKIA' + 'Q'.repeat(16);

  it('finds private addresses, preview hosts, secrets and source maps in bundles (planted)', () => {
    const findings = scanOutput(new Map([
      ['_next/static/chunks/app.js', 'fetch("http://192.168.1.20:8080/api");'],
      ['about/index.html', '<a href="https://my-site.pages.dev/">x</a>'],
      ['_next/static/chunks/b.js', `const k="${fakeKey}"`],
      ['_next/static/chunks/c.js.map', '{}'],
      ['_headers', 'https://:project.pages.dev/*\n  X-Robots-Tag: noindex'],
      ['index.html', '<p>Versions 1.10.2 and 16.4.2 are not addresses</p>'],
    ]));
    expect(findings.map((f: { file: string; what: string }) => `${f.file}: ${f.what}`)).toEqual([
      '_next/static/chunks/app.js: a private IP address',
      'about/index.html: a pages.dev or workers.dev preview host',
      '_next/static/chunks/b.js: a AWS access key id',
      '_next/static/chunks/c.js.map: a source map ships in the output (it exposes the source)',
    ]);
  });
});

describe('check:security: responses', () => {
  it('flags version banners', () => {
    expect(headerLeaks({ 'x-powered-by': 'Next.js', server: 'nginx/1.25.3' })).toHaveLength(2);
    expect(headerLeaks({ server: 'cloudflare' })).toEqual([]);
  });

  it('wants a strict CSP (planted: unsafe-eval, no frame-ancestors)', () => {
    expect(cspProblems(csp())).toEqual([]);
    expect(cspProblems("default-src 'self'; script-src 'self' 'unsafe-eval'; object-src 'none'")).toEqual(["CSP allows 'unsafe-eval'", "CSP lacks frame-ancestors 'none'"]);
    expect(cspProblems('')).toEqual(['no Content-Security-Policy header']);
  });

  it('finds resources the CSP would block', () => {
    const value = csp();
    expect(cspAllows(value, 'script-src', 'https://www.googletagmanager.com', SITE)).toBe(false);
    expect(resourcesOutsideCsp('<script src="https://cdn.other.test/x.js"></script><img src="/a.png">', value, SITE)).toEqual(['script-src https://cdn.other.test']);
  });

  it('treats an unescaped echo of an XSS payload as a finding (planted)', () => {
    const payload = XSS_PAYLOADS[0]!;
    expect(xssEchoed(`<p>You searched for ${payload}</p>`, payload)).toBe(true);
    expect(xssEchoed('<p>You searched for &quot;&gt;&lt;script&gt;</p>', payload)).toBe(false);
  });

  it('passes traversal probes only on 400/403/404 or a same-origin redirect', () => {
    expect(traversalProblem(404, '')).toBeNull();
    expect(traversalProblem(308, '', '/etc/passwd/')).toBeNull();
    expect(traversalProblem(200, 'root:x:0:0:root:/root:/bin/bash')).toMatch(/system file/);
    expect(traversalProblem(302, '', 'https://evil.test/')).toBe('answered 302');
  });

  it('fails a cross-origin POST that succeeds (planted CSRF)', () => {
    expect(csrfProblem(405)).toBeNull();
    expect(csrfProblem(200)).toMatch(/answered 200/);
  });

  it('wants the site to survive a burst, and endpoints to rate-limit', () => {
    expect(burstProblems(Array(20).fill(200))).toEqual([]);
    expect(burstProblems([200, 503, 200])).toEqual(['1 of 3 responses were 5xx']);
    expect(burstProblems(Array(20).fill(200), { endpoint: true })).toEqual([expect.stringMatching(/without a 429/)]);
  });

  it('wants every response through Cloudflare', () => {
    expect(cdnProblem({ server: 'cloudflare', 'cf-ray': '8a1b-LHR' }, '/')).toBeNull();
    expect(cdnProblem({ server: 'nginx' }, 'the origin')).toMatch(/not served by Cloudflare/);
  });
});

describe('check:security: DNS and email', () => {
  it('flags DNS-only records that expose the origin', () => {
    expect(inRanges('104.16.1.1', ['104.16.0.0/13'])).toBe(true);
    expect(inRanges('2606:4700::1', ['2606:4700::/32'])).toBe(true);
    expect(unproxiedRecords([{ name: 'example-site.test', type: 'A', ip: '104.21.3.4' }, { name: 'www.example-site.test', type: 'A', ip: '203.0.113.9' }])).toEqual([expect.stringMatching(/www\.example-site\.test A 203\.0\.113\.9 is outside/)]);
  });

  const noMail = { spf: ['v=spf1 -all'], mx: ['0 .'], dmarc: ['v=DMARC1; p=reject'], today: '2026-10-29' };

  it('passes a domain locked against spoofing', () => {
    expect(emailProblems(noMail)).toEqual([]);
  });

  it('fails a missing DMARC record (planted)', () => {
    expect(emailProblems({ ...noMail, dmarc: [] })).toEqual(['no DMARC record at _dmarc (v=DMARC1)']);
  });

  it('fails p=none past its review date, a soft SPF on a no-mail domain, and two SPF records', () => {
    expect(emailProblems({ ...noMail, dmarc: ['v=DMARC1; p=none'], reviewBy: '2026-10-01' })).toEqual([expect.stringMatching(/still p=none past its review date/)]);
    expect(emailProblems({ ...noMail, spf: ['v=spf1 include:_spf.google.com ~all'] })).toEqual([expect.stringMatching(/needs "v=spf1 -all"/)]);
    expect(emailProblems({ ...noMail, spf: ['v=spf1 -all', 'v=spf1 ~all'] })).toEqual([expect.stringMatching(/2 SPF records/)]);
    expect(emailProblems({ ...noMail, mx: [] })).toEqual([expect.stringMatching(/null MX record/)]);
  });

  it('wants DKIM for a domain that sends mail', () => {
    expect(emailProblems({ ...noMail, sendsMail: true, spf: ['v=spf1 include:mail.test -all'], mx: ['10 mx.mail.test.'], dkim: { s1: false } })).toEqual([expect.stringMatching(/no DKIM key found for selector\(s\) s1/)]);
  });
});
