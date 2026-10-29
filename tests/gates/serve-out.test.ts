// The local server for e2e and audits (scripts/serve-out.mjs): it behaves like the CDN, and never serves a file
// outside the output folder (planted traversal requests).
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler, matches, parseHeaders, resolveUnderRoot } from '../../scripts/serve-out.mjs';

let server: Server;
let base = '';
const parent = mkdtempSync(path.join(tmpdir(), 'serve-out-'));
const root = path.join(parent, 'out');

beforeAll(async () => {
  mkdirSync(path.join(root, 'about'), { recursive: true });
  writeFileSync(path.join(root, 'index.html'), `<h1>Home</h1>${'x'.repeat(2000)}`);
  writeFileSync(path.join(root, 'about', 'index.html'), '<h1>About</h1>');
  writeFileSync(path.join(root, '404.html'), '<h1>Not found</h1>');
  writeFileSync(path.join(parent, 'secret.txt'), 'outside the output folder');
  mkdirSync(path.join(parent, 'out-backup'));
  writeFileSync(path.join(parent, 'out-backup', 'index.html'), 'a sibling folder');
  const rules = parseHeaders('/*\n  X-Content-Type-Options: nosniff\n\n/_next/static/*\n  Cache-Control: immutable\n\nhttps://example.com/*\n  Strict-Transport-Security: max-age=1\n');
  server = createServer(createHandler(root, rules));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(parent, { recursive: true, force: true });
});

describe('serve-out', () => {
  it('serves pages with the _headers path rules, and skips host rules', async () => {
    const r = await fetch(`${base}/about/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('strict-transport-security')).toBeNull();
  });

  it('redirects a missing trailing slash with 308, like the CDN', async () => {
    const r = await fetch(`${base}/about`, { redirect: 'manual' });
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe('/about/');
  });

  it('answers 404 with the 404 page', async () => {
    const r = await fetch(`${base}/nope/`);
    expect(r.status).toBe(404);
    expect(await r.text()).toContain('Not found');
  });

  it('refuses anything but GET and HEAD (a static site has no endpoint)', async () => {
    const r = await fetch(`${base}/`, { method: 'POST', body: 'x' });
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('GET, HEAD');
  });

  it('compresses text when the client asks', async () => {
    const r = await fetch(`${base}/`, { headers: { 'accept-encoding': 'gzip' } });
    expect(r.headers.get('content-encoding')).toBe('gzip');
    expect(await r.text()).toContain('<h1>Home</h1>');
  });

  it('never serves a file outside the output folder (planted traversal probes)', async () => {
    for (const probe of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/%00', '/%E0%A4%A']) {
      const r = await fetch(`${base}${probe}`);
      expect([400, 404], probe).toContain(r.status);
      expect(await r.text(), probe).not.toContain('outside the output folder');
    }
  });

  it('keeps the root boundary at a separator, not a name prefix', () => {
    expect(resolveUnderRoot(root, '/../out-backup/index.html')).toBeNull();
    expect(resolveUnderRoot(root, '/about/index.html')).toBe(path.join(root, 'about', 'index.html'));
  });

  it('matches _headers patterns', () => {
    expect(matches('/_next/static/*', '/_next/static/chunks/a.js')).toBe(true);
    expect(matches('/about/', '/about/x')).toBe(false);
  });
});
