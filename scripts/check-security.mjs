// The blueprint's security table as one command (docs/TODO-step-c.md §3, docs/BLUEPRINT.md "Security checks"):
//   static, on build.outputDir: private IPs, localhost and internal hosts, preview URLs, secrets and source maps;
//   live, against the project's own host only: header leaks, CSP, XSS payloads, CSRF (cross-origin POST),
//   path traversal, a capped request burst, served only through the CDN, no unproxied DNS record, SPF/DKIM/DMARC.
// Every check is a pure function the tests feed planted failing cases. Read-only probes, never a third party:
// requests go to the target and to Cloudflare's public DNS-over-HTTPS resolver only.
//
//   node scripts/check-security.mjs https://<preview-or-domain>           (CI passes LIVE_SITE_URL, LIVE_PAGES_HOST)
//   node scripts/check-security.mjs http://localhost:4321 --local          (scripts/serve-out.mjs; skips DNS and CDN)
//   node scripts/check-security.mjs --static                               (the output folder only, no network)
//   --burst <n> (default 60, at most 100), --no-email, --no-dns
import { existsSync } from 'node:fs';
import { findSecrets } from '../.claude/hooks/secret-patterns.mjs';
import { domainOf, isMain, outputDir, readConfig } from './lib/site.mjs';
import { readOutput } from './check-out.mjs';

// ---------- target: the project's own hosts only ----------

/** The hosts this project may probe: its domain and www twin, the live and preview hosts CI names, and its pages.dev hosts. */
/** @param {any} cfg @param {import('./lib/site.mjs').Env} [env] */
export function allowedHosts(cfg, env = process.env) {
  const hosts = new Set();
  const twin = (h) => [h, h.startsWith('www.') ? h.slice(4) : `www.${h}`];
  const domain = domainOf(cfg);
  if (domain) twin(domain).forEach((h) => hosts.add(h));
  for (const v of [env.LIVE_SITE_URL, env.PREVIEW_URL]) {
    try {
      if (v) twin(new URL(v).hostname).forEach((h) => hosts.add(h));
    } catch { /* not a URL: ignored */ }
  }
  const suffixes = [env.LIVE_PAGES_HOST, cfg.project?.name ? `${String(cfg.project.name).toLowerCase()}.pages.dev` : ''].filter(Boolean).map((s) => s.toLowerCase());
  return { hosts, suffixes };
}

/** @param {string} raw @param {any} cfg @param {import('./lib/site.mjs').Env} [env] @param {{ local?: boolean }} [options] */
export function checkTarget(raw, cfg, env = process.env, { local = false } = {}) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a URL`);
  }
  if (u.username || u.password) throw new Error('the target URL must not carry credentials');
  const host = u.hostname.toLowerCase();
  if (local) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new Error('--local targets localhost only');
    return `${u.protocol}//${u.host}`;
  }
  if (u.protocol !== 'https:') throw new Error('the target must be https (use --local for a local server)');
  const { hosts, suffixes } = allowedHosts(cfg, env);
  const ok = hosts.has(host) || suffixes.some((s) => host === s || host.endsWith(`.${s}`));
  if (!ok) throw new Error(`${host} is not one of this project's hosts (project.domain, LIVE_SITE_URL, LIVE_PAGES_HOST, PREVIEW_URL): probes never target anyone else`);
  return `https://${u.host}`;
}

// ---------- static: the output folder ----------

const PRIVATE_IP = /(?<![\d.])(?:10\.(?:\d{1,3}\.){2}\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})(?![\d.])/;
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|0\.0\.0\.0|\[::1\])(?::\d+)?/i;
const INTERNAL_HOST = /\bhttps?:\/\/[a-z0-9.-]+\.(?:internal|local|lan|corp|intranet|home\.arpa)(?![a-z0-9-])/i;
const PREVIEW_HOST = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:pages|workers)\.dev\b/i;

/** Leaks in the built files: [{ file, line, what }]. Values are never returned (they may be secrets). */
export function scanOutput(files) {
  const findings = [];
  for (const [name, text] of files) {
    if (name.endsWith('.map')) {
      findings.push({ file: name, line: 0, what: 'a source map ships in the output (it exposes the source)' });
      continue;
    }
    if (!text) continue;
    // _headers and _redirects are host configuration, never served, and they name the preview hosts on purpose.
    const hostConfig = /(?:^|\/)_(?:headers|redirects)$/.test(name);
    text.split(/\r?\n/).forEach((line, i) => {
      for (const [re, what] of hostConfig ? [] : [[PRIVATE_IP, 'a private IP address'], [LOCAL_URL, 'a localhost URL'], [INTERNAL_HOST, 'an internal host name'], [PREVIEW_HOST, 'a pages.dev or workers.dev preview host']]) {
        if (re.test(line)) findings.push({ file: name, line: i + 1, what });
      }
    });
    for (const h of findSecrets(text)) findings.push({ file: name, line: h.line, what: `a ${h.rule}` });
  }
  return findings;
}

// ---------- live: responses ----------

/** Version banners and framework names in headers. */
export function headerLeaks(headers) {
  const p = [];
  if (headers['x-powered-by']) p.push(`x-powered-by: ${headers['x-powered-by']}`);
  for (const k of ['x-aspnet-version', 'x-aspnetmvc-version', 'x-generator', 'x-runtime']) if (headers[k]) p.push(`${k} is sent`);
  if (/\/\d/.test(headers.server ?? '')) p.push(`server header names a version (${headers.server})`);
  if (headers.via && !/cloudflare/i.test(headers.via)) p.push(`via header leaks a proxy (${headers.via})`);
  return p;
}

/** CSP problems: present, no unsafe-eval, framing refused, plugins off. */
export function cspProblems(value) {
  if (!value) return ['no Content-Security-Policy header'];
  const p = [];
  if (/'unsafe-eval'/.test(value)) p.push("CSP allows 'unsafe-eval'");
  if (!/frame-ancestors 'none'/.test(value)) p.push("CSP lacks frame-ancestors 'none'");
  if (!/object-src 'none'/.test(value)) p.push("CSP lacks object-src 'none'");
  if (!/default-src 'self'/.test(value)) p.push("CSP lacks default-src 'self'");
  return p;
}

const directive = (value, name) => {
  const d = String(value).split(';').map((s) => s.trim().split(/\s+/)).find((parts) => parts[0] === name);
  return d ? d.slice(1) : null;
};

/** Whether the CSP allows loading `origin` for a directive (falls back to default-src); handles https://*.host. */
export function cspAllows(value, name, origin, self) {
  const list = directive(value, name) ?? directive(value, 'default-src') ?? [];
  return list.some((s) => (s === "'self'" && origin === self) || s === origin || (s.startsWith('https://*.') && origin.startsWith('https://') && origin.endsWith(s.slice('https://*'.length))));
}

/** Resources on a page that the CSP would block (scripts, styles, images, frames on other origins). */
export function resourcesOutsideCsp(html, cspValue, self) {
  const out = [];
  const kinds = [[/<script\b[^>]*\ssrc="([^"]+)"/gi, 'script-src'], [/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi, 'style-src'], [/<img\b[^>]*\ssrc="([^"]+)"/gi, 'img-src'], [/<iframe\b[^>]*\ssrc="([^"]+)"/gi, 'frame-src']];
  for (const [re, name] of kinds) {
    for (const m of html.matchAll(re)) {
      let origin;
      try {
        origin = new URL(m[1], self + '/').origin;
      } catch {
        continue;
      }
      if (origin !== self && !cspAllows(cspValue, name, origin, self)) out.push(`${name} ${origin}`);
    }
  }
  return [...new Set(out)];
}

export const XSS_PAYLOADS = ['"><script>alert(1)</script>', "'><img src=x onerror=alert(1)>", '" onmouseover="alert(1)', 'javascript:alert(1)//'];
/** A payload echoed back unescaped (the tag or handler survives as markup). */
export function xssEchoed(body, payload) {
  if (!body.includes(payload)) return false;
  return /<script>|<img |onerror=|onmouseover=|javascript:/.test(payload);
}

export const TRAVERSAL_PROBES = ['/..%2f..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/..;/..;/etc/passwd', '/%252e%252e/%252e%252e/etc/passwd', '/..%5c..%5cwindows%5cwin.ini', '/....//....//etc/passwd'];
const FILE_CONTENTS = /root:x?:0:0:|\[(?:boot loader|extensions|fonts)\]|daemon:x?:1:1:/i;
/** A traversal probe passes on 400, 403, 404 or a same-origin redirect, and never with a system file's contents. */
export function traversalProblem(status, body, location = '', self = '') {
  if (FILE_CONTENTS.test(body)) return 'returned the contents of a system file';
  if ([400, 403, 404].includes(status)) return null;
  if ([301, 302, 307, 308].includes(status) && (location.startsWith('/') || (self && location.startsWith(self + '/')))) return null;
  return `answered ${status}`;
}

/** A cross-origin POST must never succeed on a static site (405, 403 or 404 expected). */
export const csrfProblem = (status) => (status >= 200 && status < 300 ? `a cross-origin POST answered ${status}` : null);

/** A capped burst: the site must keep answering (no 5xx); endpoints must start returning 429. */
export function burstProblems(statuses, { endpoint = false } = {}) {
  const p = [];
  const errors = statuses.filter((s) => s >= 500).length;
  if (errors) p.push(`${errors} of ${statuses.length} responses were 5xx`);
  if (endpoint && !statuses.includes(429)) p.push(`an endpoint answered all ${statuses.length} requests without a 429 (add Cloudflare's free rate-limiting rule)`);
  return p;
}

/** Served only through Cloudflare: server: cloudflare and a cf-ray id on every response. */
export const cdnProblem = (headers, what) => (/^cloudflare$/i.test(headers.server ?? '') && headers['cf-ray'] ? null : `${what} was not served by Cloudflare (server "${headers.server ?? ''}", cf-ray "${headers['cf-ray'] ?? ''}")`);

// Cloudflare's published ranges (cloudflare.com/ips-v4 and ips-v6). The live list is fetched first; this copy is
// the fallback [U: re-check against cloudflare.com/ips when it changes].
export const CLOUDFLARE_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
export const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

const v4 = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
function v6(ip) {
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const parts = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return parts.reduce((n, h) => (n << 16n) + BigInt(parseInt(h || '0', 16)), 0n);
}
/** Whether an IPv4 or IPv6 address is inside one of the CIDR ranges. */
export function inRanges(ip, ranges) {
  const six = ip.includes(':');
  return ranges.filter((r) => r.includes(':') === six).some((r) => {
    const [base, bits] = r.split('/');
    if (six) {
      const shift = BigInt(128 - Number(bits));
      return v6(ip) >> shift === v6(base) >> shift;
    }
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return ((v4(ip) & mask) >>> 0) === ((v4(base) & mask) >>> 0);
  });
}

/** Web hostnames whose A/AAAA records point outside Cloudflare: DNS-only (grey cloud) records reveal the origin. */
export function unproxiedRecords(records, ranges = [...CLOUDFLARE_V4, ...CLOUDFLARE_V6]) {
  return records.filter((r) => !inRanges(r.ip, ranges)).map((r) => `${r.name} ${r.type} ${r.ip} is outside Cloudflare's ranges (a DNS-only record exposes the origin)`);
}

/**
 * SPF, DKIM and DMARC (HANDBOOK §9). A domain that receives no mail needs "v=spf1 -all" and a null MX; DMARC must
 * exist, and p=none only until its review date (factory.config.json → email.dmarcReviewBy).
 * @param {{ spf?: string[], mx?: string[], dmarc?: string[], dkim?: Record<string, boolean>, sendsMail?: boolean, reviewBy?: string, today: string }} records
 */
export function emailProblems({ spf = [], mx = [], dmarc = [], dkim = {}, sendsMail = false, reviewBy = '', today }) {
  const p = [];
  const spfs = spf.filter((t) => /^v=spf1\b/i.test(t));
  if (spfs.length === 0) p.push('no SPF record (v=spf1)');
  else if (spfs.length > 1) p.push(`${spfs.length} SPF records (receivers treat that as an error)`);
  else if (/[+?]all\b/i.test(spfs[0]) || !/[-~]all\b/i.test(spfs[0])) p.push(`SPF "${spfs[0]}" doesn't end in -all or ~all`);
  const realMx = mx.filter((m) => !/^0\s+\.?$/.test(m.trim()));
  const nullMx = mx.some((m) => /^0\s+\.?$/.test(m.trim()));
  if (!realMx.length && !sendsMail) {
    if (spfs.length === 1 && !/^v=spf1\s+-all$/i.test(spfs[0].trim())) p.push(`a domain that sends no mail needs "v=spf1 -all" (found "${spfs[0]}")`);
    if (!nullMx) p.push('a domain that receives no mail needs a null MX record (0 .)');
  }
  if (sendsMail) {
    const found = Object.entries(dkim).filter(([, ok]) => ok).map(([s]) => s);
    if (!Object.keys(dkim).length) p.push('the domain sends mail but factory.config.json → email.dkimSelectors names no DKIM selector to check');
    else if (!found.length) p.push(`no DKIM key found for selector(s) ${Object.keys(dkim).join(', ')}`);
  }
  const d = dmarc.filter((t) => /^v=DMARC1\b/i.test(t));
  if (!d.length) p.push('no DMARC record at _dmarc (v=DMARC1)');
  else {
    const policy = (d[0].match(/\bp=(none|quarantine|reject)\b/i)?.[1] ?? '').toLowerCase();
    if (!policy) p.push(`DMARC "${d[0]}" has no p= policy`);
    else if (policy === 'none') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) p.push('DMARC is p=none with no review date: set email.dmarcReviewBy and ramp to quarantine, then reject');
      else if (reviewBy < today) p.push(`DMARC is still p=none past its review date ${reviewBy}: ramp to quarantine`);
    }
  }
  return p;
}

// ---------- the run ----------

const headersOf = (res) => Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
const UA = 'aksitekit-check-security/1 (own-host security probe)';
const fetchText = async (url, init = {}) => {
  const res = await fetch(url, { redirect: 'manual', ...init, headers: { 'user-agent': UA, ...(init.headers ?? {}) } });
  const type = res.headers.get('content-type') ?? '';
  return { res, h: headersOf(res), body: /text|html|xml|json|javascript/.test(type) ? await res.text() : (await res.arrayBuffer(), '') };
};
const doh = async (name, type) => {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
  return (await r.json()).Answer ?? [];
};
const txt = (answers) => answers.filter((a) => a.type === 16).map((a) => a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, ''));

export async function run(args, env = process.env) {
  const flag = (n) => args.includes(n);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const cfg = readConfig();
  const failures = [];
  const notes = [];
  const check = (ok, what, detail = []) => {
    if (ok) console.log(`  ok    ${what}`);
    else {
      failures.push(what);
      console.log(`  FAIL  ${what}${detail.length ? `\n        ${detail.slice(0, 12).join('\n        ')}` : ''}`);
    }
  };

  // 1. The output folder, when it's there (CI checks a preview built from the same commit).
  const out = outputDir(cfg);
  if (existsSync(out)) {
    const findings = scanOutput(readOutput(out));
    check(!findings.length, `${out}/: no private IPs, localhost or internal hosts, preview URLs, secrets or source maps`, findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ''}: ${f.what}`));
  } else notes.push(`${out}/ isn't built here: the static scan was skipped`);
  if (flag('--static')) return { failures, notes };

  const raw = args.find((a) => /^https?:\/\//.test(a)) ?? env.TARGET_URL;
  if (!raw) throw new Error('usage: node scripts/check-security.mjs <https://own-host> [--local] [--static] [--burst n] [--no-email] [--no-dns]');
  const local = flag('--local');
  const base = checkTarget(raw, cfg, env, { local });
  const cloudflare = !local && String(cfg.hosting?.target ?? '').startsWith('cloudflare');
  console.log(`check-security: ${base}${local ? ' (local)' : ''}`);

  // 2. Home: headers, CSP, resources inside the CSP.
  const home = await fetchText(`${base}/`);
  check(home.res.status === 200, `home is 200 (got ${home.res.status})`);
  const leaks = headerLeaks(home.h);
  check(!leaks.length, 'no x-powered-by, version banners or via leaks', leaks);
  const cspList = cspProblems(home.h['content-security-policy']);
  check(!cspList.length, 'CSP: default-src self, no unsafe-eval, frame-ancestors and object-src none', cspList);
  const outside = resourcesOutsideCsp(home.body, home.h['content-security-policy'] ?? '', base);
  check(!outside.length, 'every resource on the home page is same-origin or on the CSP allow-list', outside);

  // 3. XSS: payloads in a query string and in a missing path are never echoed raw.
  const echoed = [];
  const sample = home.body.match(/href="(\/[a-z0-9-]+\/[a-z0-9-]+\/)"/)?.[1] ?? '/';
  for (const payload of XSS_PAYLOADS) {
    for (const url of [`${base}${sample}?q=${encodeURIComponent(payload)}&utm_source=${encodeURIComponent(payload)}`, `${base}/${encodeURIComponent(payload)}/`]) {
      const r = await fetchText(url);
      if (xssEchoed(r.body, payload)) echoed.push(`${url.replace(base, '')} echoes ${payload}`);
    }
  }
  check(!echoed.length, `XSS: ${XSS_PAYLOADS.length} payloads in queries and paths are never echoed raw`, echoed);

  // 4. CSRF: a static site accepts no POST, least of all a cross-origin one.
  const csrf = [];
  for (const path of ['/', sample]) {
    const r = await fetchText(`${base}${path}`, { method: 'POST', headers: { origin: 'https://attacker.invalid', 'content-type': 'application/x-www-form-urlencoded' }, body: 'probe=1' });
    const prob = csrfProblem(r.res.status);
    if (prob) csrf.push(`${path}: ${prob}`);
  }
  check(!csrf.length, 'CSRF: cross-origin POSTs are refused', csrf);

  // 5. Path traversal.
  const trav = [];
  for (const probe of TRAVERSAL_PROBES) {
    const r = await fetchText(`${base}${probe}`);
    const prob = traversalProblem(r.res.status, r.body, r.h.location ?? '', base);
    if (prob) trav.push(`${probe}: ${prob}`);
  }
  check(!trav.length, `path traversal: ${TRAVERSAL_PROBES.length} probes get 400/403/404 and no file contents`, trav);

  // 6. A capped burst against this host only (at most 100 requests, spread over about 10 s).
  const n = Math.min(100, Math.max(1, Number(opt('--burst') ?? 60)));
  const statuses = [];
  for (let i = 0; i < n; i += 10) {
    statuses.push(...(await Promise.all(Array.from({ length: Math.min(10, n - i) }, () => fetch(`${base}/`, { headers: { 'user-agent': UA } }).then(async (r) => (await r.arrayBuffer(), r.status), () => 0)))));
    await new Promise((res) => setTimeout(res, 1000));
  }
  const burst = burstProblems(statuses);
  check(!burst.length, `rate limiting: ${n} requests in about ${Math.ceil(n / 10)} s, no 5xx (${statuses.filter((s) => s === 429).length} answered 429)`, burst);
  for (const ep of cfg.security?.endpoints ?? []) {
    const eps = [];
    for (let i = 0; i < n; i++) eps.push(await fetch(`${base}${ep}`, { method: 'POST', headers: { 'user-agent': UA } }).then((r) => r.status, () => 0));
    const p = burstProblems(eps, { endpoint: true });
    check(!p.length, `rate limiting on ${ep}`, p);
  }

  // 7. Served only through Cloudflare, and no DNS-only web record.
  if (cloudflare) {
    const robots = await fetchText(`${base}/robots.txt`);
    const missing = await fetchText(`${base}/no-such-page-${Date.now()}/`);
    const cdn = [cdnProblem(home.h, 'the home page'), cdnProblem(robots.h, 'robots.txt'), cdnProblem(missing.h, 'the 404 page')].filter(Boolean);
    check(!cdn.length, 'every response comes through Cloudflare (server: cloudflare, cf-ray)', cdn);
  }
  const domain = domainOf(cfg);
  const host = new URL(base).hostname;
  const ownDomain = domain && (host === domain || host === `www.${domain}`);
  if (cloudflare && ownDomain && !flag('--no-dns')) {
    let ranges = [...CLOUDFLARE_V4, ...CLOUDFLARE_V6];
    try {
      const [a, b] = await Promise.all(['https://www.cloudflare.com/ips-v4', 'https://www.cloudflare.com/ips-v6'].map((u) => fetch(u).then((r) => (r.ok ? r.text() : ''))));
      const live = `${a}\n${b}`.split(/\s+/).filter((s) => /\/\d+$/.test(s));
      if (live.length > 10) ranges = live;
    } catch { notes.push('cloudflare.com/ips was unreachable: used the built-in range list'); }
    const records = [];
    for (const name of [domain, `www.${domain}`]) {
      for (const [type, code] of [['A', 1], ['AAAA', 28]]) for (const a of (await doh(name, type)).filter((x) => x.type === code)) records.push({ name, type, ip: a.data });
    }
    const unproxied = unproxiedRecords(records, ranges);
    check(records.length > 0 && !unproxied.length, `DNS: ${records.length} web record(s), all proxied through Cloudflare`, unproxied);
  } else if (!local) notes.push('DNS proxy check skipped (not the project domain, not a Cloudflare target, or --no-dns)');

  // 8. Email spoofing: SPF, DKIM, DMARC on the project domain.
  if (domain && !local && !flag('--no-email')) {
    const email = cfg.email ?? {};
    const dkim = {};
    for (const s of email.dkimSelectors ?? []) dkim[s] = txt(await doh(`${s}._domainkey.${domain}`, 'TXT')).some((t) => /p=\S+/.test(t));
    const problems = emailProblems({
      spf: txt(await doh(domain, 'TXT')),
      mx: (await doh(domain, 'MX')).filter((a) => a.type === 15).map((a) => a.data),
      dmarc: txt(await doh(`_dmarc.${domain}`, 'TXT')),
      dkim,
      sendsMail: email.sendsMail === true,
      reviewBy: String(email.dmarcReviewBy ?? ''),
      today: new Date().toISOString().slice(0, 10),
    });
    check(!problems.length, `email: SPF, DKIM and DMARC for ${domain}`, problems);
  } else if (!local) notes.push('email checks skipped (no project.domain, or --no-email)');

  return { failures, notes };
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).then(({ failures, notes }) => {
    for (const n of notes) console.log(`  note  ${n}`);
    console.log(failures.length ? `check-security: FAIL, ${failures.length} failure(s)` : 'check-security: OK');
    process.exitCode = failures.length ? 1 : 0;
  }, (e) => {
    console.error(`check-security: ${e.message}`);
    process.exitCode = 1;
  });
}
