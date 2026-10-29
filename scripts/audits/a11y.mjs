// Accessibility audit (`npm run audit:a11y`): axe-core (WCAG 2.0, 2.1 and 2.2 A and AA, plus best practice) on every
// sitemap page and the 404 page, in Playwright's Chromium. axe-core is read from node_modules (installed with
// eslint-plugin-jsx-a11y) and injected with page.evaluate, so nothing loads from the network. With no URL
// it serves build.outputDir itself.
//
//   node scripts/audits/a11y.mjs [baseURL]
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { isMain, outputDir, readConfig } from '../lib/site.mjs';
import { sitemapLocs } from '../lib/public-files.mjs';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** One line per violation, and the total node count. */
export function summarise(results) {
  const lines = [];
  let total = 0;
  for (const { path, violations } of results) {
    for (const v of violations) {
      total += v.nodes;
      lines.push(`${path}  ${v.id} (${v.impact}, ${v.nodes} node(s)): ${v.help}${v.sample ? `; e.g. ${v.sample}` : ''}`);
    }
  }
  return { lines, total };
}

if (isMain(import.meta.url)) {
  const cfg = readConfig();
  let base = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
  let axe;
  try {
    axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    console.error('audit:a11y: axe-core is not installed (it comes with eslint-plugin-jsx-a11y; run npm ci)');
    process.exit(1);
  }
  let server;
  if (!base) {
    const { startServer } = await import('../serve-out.mjs');
    ({ server, url: base } = await startServer(cfg, 0));
  }
  base = base.replace(/\/+$/, '');
  const sm = join(outputDir(cfg), 'sitemap.xml');
  const paths = [...(existsSync(sm) ? sitemapLocs(readFileSync(sm, 'utf8')).map((l) => l.replace(/^https?:\/\/[^/]+/, '')) : ['/']), '/404.html'];
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];
  try {
    for (const path of paths) {
      const res = await page.goto(base + path, { waitUntil: 'load', timeout: 60_000 });
      if (!res || (res.status() >= 400 && path !== '/404.html')) {
        results.push({ path, violations: [{ id: 'page-load', impact: 'critical', nodes: 1, help: `HTTP ${res?.status()}` }] });
        continue;
      }
      await page.evaluate(axe);
      const violations = await page.evaluate(async (tags) => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes[0]?.target?.join(' ') }));
      }, TAGS);
      results.push({ path, violations });
    }
  } finally {
    await browser.close();
    server?.close();
  }
  const { lines, total } = summarise(results);
  for (const l of lines) console.error(`  ${l}`);
  console.log(total ? `audit:a11y: FAIL, ${total} violation(s) on ${paths.length} page(s)` : `audit:a11y: OK (${paths.length} page(s), 0 axe violations [M: axe-core])`);
  process.exitCode = total ? 1 : 0;
}
