// Lab page speed with Playwright's Chromium (`npm run audit:perf`): Lighthouse's mobile throttling (slow 4G: 150 ms
// round trip, 1.6 Mbps down, 750 Kbps up; 4x CPU slowdown; a 412 × 823 phone) or none for desktop; the median of N
// runs per page for LCP, CLS, TBT and FCP, against factory.config.json → budgets.coreWebVitals.
//
// LAB numbers, not field data. INP needs real visitors (Chrome UX Report); TBT is the lab proxy held to the INP budget
// here [P]. With no URL it serves build.outputDir itself and measures every sitemap page (at most 8).
//
//   node scripts/audits/perf.mjs [baseURL] [mobile|desktop] [runs] [paths...]
//   In Git Bash, prefix MSYS_NO_PATHCONV=1 so "/path/" arguments aren't rewritten.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, outputDir, readConfig } from '../lib/site.mjs';
import { sitemapLocs } from '../lib/public-files.mjs';

export const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** Pages over budget: [{ path, metric, value, budget }]. */
export function budgetProblems(rows, cwv) {
  const out = [];
  for (const r of rows) {
    if (r.lcp > cwv.lcpMs) out.push({ path: r.path, metric: 'LCP', value: `${(r.lcp / 1000).toFixed(2)} s`, budget: `${cwv.lcpMs / 1000} s` });
    if (r.cls > cwv.cls) out.push({ path: r.path, metric: 'CLS', value: r.cls.toFixed(3), budget: String(cwv.cls) });
    if (r.tbt > cwv.inpMs) out.push({ path: r.path, metric: 'TBT (INP proxy)', value: `${Math.round(r.tbt)} ms`, budget: `${cwv.inpMs} ms` });
  }
  return out;
}

async function measure(browser, url, mobile) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true } : { viewport: { width: 1350, height: 940 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (mobile) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.addInitScript(() => {
    window.__m = { lcp: 0, cls: 0, tasks: [] };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.tasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(mobile ? 5000 : 2000);
  const m = await page.evaluate(() => ({
    lcp: window.__m.lcp,
    cls: window.__m.cls,
    tasks: window.__m.tasks,
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0,
    bytes: performance.getEntriesByType('resource').reduce((s, e) => s + (e.transferSize || 0), 0) + (performance.getEntriesByType('navigation')[0]?.transferSize || 0),
  }));
  m.tbt = m.tasks.filter(([s]) => s >= m.fcp).reduce((s, [, d]) => s + Math.max(0, d - 50), 0);
  await ctx.close();
  return m;
}

if (isMain(import.meta.url)) {
  const cfg = readConfig();
  const args = process.argv.slice(2);
  let base = args.find((a) => /^https?:\/\//.test(a));
  const rest = args.filter((a) => a !== base);
  const mode = rest[0] === 'desktop' ? 'desktop' : 'mobile';
  const runs = Number(rest.find((a) => /^\d+$/.test(a)) ?? 3);
  let paths = rest.filter((a) => a.startsWith('/'));
  let server;
  if (!base) {
    const { startServer } = await import('../serve-out.mjs');
    ({ server, url: base } = await startServer(cfg, 0));
  }
  base = base.replace(/\/+$/, '');
  if (!paths.length) {
    const sm = join(outputDir(cfg), 'sitemap.xml');
    paths = existsSync(sm) ? sitemapLocs(readFileSync(sm, 'utf8')).map((l) => l.replace(/^https?:\/\/[^/]+/, '')).slice(0, 8) : ['/'];
  }
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const rows = [];
  console.log(`audit:perf: ${base} (${mode}, median of ${runs}) [M: lab, Playwright Chromium]`);
  try {
    for (const path of paths) {
      const res = [];
      for (let r = 0; r < runs; r++) res.push(await measure(browser, base + path, mode === 'mobile'));
      const p = (k) => median(res.map((x) => x[k]));
      const row = { path, lcp: p('lcp'), cls: p('cls'), tbt: p('tbt'), fcp: p('fcp'), bytes: p('bytes') };
      rows.push(row);
      console.log(`  LCP ${(row.lcp / 1000).toFixed(2)} s  CLS ${row.cls.toFixed(3)}  TBT ${Math.round(row.tbt)} ms  FCP ${(row.fcp / 1000).toFixed(2)} s  ${Math.round(row.bytes / 1024)} KB  ${path}`);
    }
  } finally {
    await browser.close();
    server?.close();
  }
  const over = budgetProblems(rows, cfg.budgets?.coreWebVitals ?? { lcpMs: 2500, cls: 0.1, inpMs: 200 });
  for (const o of over) console.error(`  OVER ${o.metric} ${o.value} (budget ${o.budget})  ${o.path}`);
  console.log(over.length ? `audit:perf: FAIL, ${over.length} measurement(s) over budget` : `audit:perf: OK (${rows.length} page(s) within factory.config.json → budgets.coreWebVitals)`);
  process.exitCode = over.length ? 1 : 0;
}
