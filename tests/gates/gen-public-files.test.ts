// scripts/gen-public-files.mjs: which build turns analytics and ads on, the files written before the build, and the
// sitemap and llms.txt written after it from a planted output folder.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { afterBuild, beforeBuild, buildFeatures } from '../../scripts/gen-public-files.mjs';

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const cfg = {
  project: { name: 'Example', domain: 'example-site.test', brand: 'Example Site', locale: 'en' },
  hosting: { target: 'cloudflare-pages', productionBranch: 'main' },
  build: { framework: 'nextjs', outputDir: 'out' },
  bots: { search: 'allow', adsense: 'allow', aiSearch: 'allow', aiTraining: 'block' },
  analytics: { ga4MeasurementId: 'G-ABCDE12345' },
  monetization: { adsense: { enabled: true, publisherId: 'pub-1234567890123456' } },
};

describe('buildFeatures', () => {
  it('turns analytics and ads on only in an indexable production build', () => {
    expect(buildFeatures(cfg, { SITE_ENV: 'production', SITE_INDEXABLE: 'true' })).toEqual({ analytics: true, ads: true });
    expect(buildFeatures(cfg, { SITE_ENV: 'production' })).toEqual({ analytics: false, ads: false });
    expect(buildFeatures(cfg, { CF_PAGES: '1', CF_PAGES_BRANCH: 'preview', SITE_INDEXABLE: 'true' })).toEqual({ analytics: false, ads: false });
    expect(buildFeatures({ ...cfg, analytics: { ga4MeasurementId: 'UA-1' } }, { SITE_ENV: 'production', SITE_INDEXABLE: 'true' }).analytics).toBe(false);
  });
});

describe('beforeBuild', () => {
  it('writes robots.txt, _headers and security.txt for the project domain', () => {
    const files = beforeBuild(cfg, {}, new Date('2026-10-29T00:00:00Z'));
    expect(Object.keys(files)).toEqual(['robots.txt', '_headers', '.well-known/security.txt']);
    expect(files['robots.txt']).toContain('Sitemap: https://example-site.test/sitemap.xml');
    expect(files['robots.txt']).toMatch(/User-agent: GPTBot\nDisallow: \//);
    expect(files._headers).toContain('https://example-site.test/*');
    expect(files._headers).not.toMatch(/googletagmanager|googlesyndication/); // a local build sends neither
  });

  it('refuses a site URL that is not an https origin (planted)', () => {
    expect(() => beforeBuild(cfg, { SITE_URL: 'http://example-site.test' })).toThrow(/must be an https origin/);
    expect(() => beforeBuild(cfg, { SITE_URL: 'https://example-site.test/blog' })).toThrow(/must be an https origin/);
  });
});

describe('afterBuild', () => {
  it('builds the sitemap and llms.txt from the pages the build wrote', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'gen-out-'));
    temps.push(out);
    const page = (dir: string, title: string, robots = 'noindex, nofollow') => {
      mkdirSync(path.join(out, dir), { recursive: true });
      writeFileSync(path.join(out, dir, 'index.html'), `<html><head><title>${title}</title><meta name="description" content="About ${title}"><meta name="robots" content="${robots}"></head><body><main><h1>${title}</h1></main></body></html>`);
    };
    page('', 'Home');
    page('handbook', 'Handbook');
    page('held', 'Held', 'noindex, follow');
    writeFileSync(path.join(out, '404.html'), '<html><head><title>Not found</title></head><body><h1>Not found</h1></body></html>');
    const r = afterBuild(cfg, { SITE_OUT: out });
    expect(r.count).toBe(2);
    expect(r.files['sitemap.xml']).toContain('<loc>https://example-site.test/handbook/</loc>');
    expect(r.files['sitemap.xml']).not.toMatch(/held|404/);
    expect(r.files['llms.txt'].startsWith('# Example Site\n')).toBe(true);
  });

  it('fails when the build wrote no home page', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'gen-out-'));
    temps.push(out);
    mkdirSync(path.join(out, 'a'));
    writeFileSync(path.join(out, 'a', 'index.html'), '<html><head><title>A</title></head></html>');
    expect(() => afterBuild(cfg, { SITE_OUT: out })).toThrow(/index\.html is missing/);
  });
});
