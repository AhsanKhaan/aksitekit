// A small static server for build.outputDir (no dependencies), used by `npm run serve`, Playwright, Lighthouse CI and
// the local check:live / check:security runs. It behaves like Cloudflare's static hosting where it matters for the
// gates: the _headers rules for path patterns, the trailing-slash redirect, the 404 page, compression, and no
// method but GET and HEAD.
//
//   PORT=4321 node scripts/serve-out.mjs
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { isMain, outputDir, publicDir, readConfig } from './lib/site.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

/** _headers rules for paths ("/*", "/_next/static/*"); host rules (previews, HSTS on the domain) don't apply locally. */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push((current = { pattern: line.trim(), headers: [] }));
    else if (current && line.includes(':')) {
      const i = line.indexOf(':');
      current.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules.filter((r) => r.pattern.startsWith('/'));
}

export const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern);

/**
 * A request path as a file strictly inside root, or null when it escapes. The boundary is root + separator: a bare
 * prefix test would also accept a sibling folder whose name starts with root's name ("out-backup").
 */
export function resolveUnderRoot(root, urlPath) {
  const file = normalize(join(root, urlPath));
  return file === root || file.startsWith(root + sep) ? file : null;
}

const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|manifest\+json)|image\/svg)/;

export function createHandler(root, rules) {
  const cache = new Map();
  const encode = (file, body, accept) => {
    const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
    if (!enc || body.length < 1024) return { body };
    const key = `${enc}:${file}:${statSync(file).mtimeMs}`;
    if (!cache.has(key)) cache.set(key, enc === 'br' ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : gzipSync(body));
    return { body: cache.get(key), enc };
  };
  return (req, res) => {
    // A static site has no endpoint: anything but GET and HEAD is refused, as the CDN does (the CSRF check relies on it).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }).end('Method Not Allowed');
      return;
    }
    const parsed = new URL(req.url ?? '/', 'http://x');
    let urlPath;
    try {
      urlPath = decodeURIComponent(parsed.pathname);
    } catch {
      urlPath = '/__malformed__/'; // a stray "%" gets the 404 page, never a crash
    }
    if (urlPath.includes('\0')) urlPath = '/__malformed__/';
    let file = resolveUnderRoot(root, urlPath);
    if (file === null) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    let status = 200;
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!urlPath.endsWith('/') && existsSync(join(file, 'index.html'))) {
        res.writeHead(308, { Location: `${urlPath}/${parsed.search}` }).end();
        return;
      }
      file = join(file, 'index.html');
    }
    if (!existsSync(file)) {
      file = join(root, '404.html');
      status = 404;
    }
    const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
    for (const r of rules) if (matches(r.pattern, urlPath)) for (const [k, v] of r.headers) headers[k] = v;
    if (process.env.CSP_REPORT_ONLY) headers['Content-Security-Policy-Report-Only'] = process.env.CSP_REPORT_ONLY;
    if (!existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    let body = readFileSync(file);
    if (COMPRESSIBLE.test(headers['Content-Type'])) {
      const out = encode(file, body, String(req.headers['accept-encoding'] ?? ''));
      body = out.body;
      if (out.enc) headers['Content-Encoding'] = out.enc;
      headers.Vary = 'Accept-Encoding';
    }
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

/** Serve the built site; port 0 picks a free one. Resolves to { server, url, root, rules }. */
export function startServer(cfg = readConfig(), port = Number(process.env.PORT ?? 4321)) {
  const root = resolve(outputDir(cfg));
  if (!existsSync(root)) throw new Error(`${root} not found: run npm run build first`);
  const headersFile = [join(root, '_headers'), join(publicDir(cfg), '_headers')].find(existsSync);
  const rules = headersFile ? parseHeaders(readFileSync(headersFile, 'utf8')) : [];
  const server = createServer(createHandler(root, rules));
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, () => ok({ server, url: `http://localhost:${server.address().port}`, root, rules }));
  });
}

if (isMain(import.meta.url)) {
  startServer().then(({ url, root, rules }) => console.log(`serve-out: ${url} → ${root} (${rules.length} _headers rules)`), (e) => {
    console.error(`serve-out: ${e.message}`);
    process.exitCode = 1;
  });
}
