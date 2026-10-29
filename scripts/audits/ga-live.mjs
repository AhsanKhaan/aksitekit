// Live GA4 privacy and consent check (`npm run audit:ga`), after a deploy and after any change in the GA4 property.
// GA4's collect requests are captured and ABORTED, so nothing reaches the property. navigator.webdriver is masked for
// this run only, because components/Analytics.tsx refuses automated browsers on purpose.
//
// Fails if:
// - a hit carries the query string of the visited address (dl or dr), or the test's sentinel value anywhere;
// - GA4's own form interactions or history-based page views are on (a second page_view for one navigation);
// - a page view has no title;
// - in a European time zone, anything loads before Accept, or nothing after it.
//
//   npm run audit:ga -- [https://example.com]        (default: LIVE_SITE_URL, else https://project.domain)
import { domainOf, isMain, readConfig } from '../lib/site.mjs';

export const SENTINEL = 'aksitekit987654';

/** Every event in captured collect hits, retries removed: [{ en, dl, dr, dt, raw }]. */
export function eventsOf(hits) {
  const seen = new Set();
  return hits
    .flatMap(({ url, body }) => {
      const base = Object.fromEntries(new URL(url).searchParams);
      const lines = String(body ?? '').split('\n').filter(Boolean);
      return (lines.length ? lines : ['']).map((l) => ({ ...base, ...Object.fromEntries(new URLSearchParams(l)), raw: `${url}\n${l}` }));
    })
    .filter((e) => {
      const key = [e.en, e.dl, e.dr, e.dt].join('|');
      return seen.has(key) ? false : (seen.add(key), true);
    });
}

/** Problems with the events of a visit outside Europe that loaded `first`, then navigated to `second`. */
export function visitProblems(events, { first, second }) {
  const p = [];
  if (events.some((e) => e.raw.includes(SENTINEL))) p.push('a hit carries the sentinel from the visited address (query strings must never reach GA4)');
  if (events.some((e) => String(e.dl ?? '').includes('?') || String(e.dr ?? '').includes('?'))) p.push('a hit carries an address or referrer with a query string');
  if (events.some((e) => /^form_/.test(e.en ?? ''))) p.push('GA4 form interactions are on (form_start / form_submit): turn off Enhanced measurement → Form interactions');
  const views = events.filter((e) => e.en === 'page_view');
  if (!views.some((e) => e.dl === first)) p.push(`no page_view for ${first}`);
  if (views.filter((e) => e.dl === second).length !== 1) p.push(`${views.filter((e) => e.dl === second).length} page_view(s) for ${second} (one per navigation: turn off history-based page views)`);
  if (views.some((e) => !e.dt)) p.push('a page_view has no page title');
  return p;
}

if (isMain(import.meta.url)) {
  const cfg = readConfig();
  const arg = process.argv.slice(2).find((a) => /^https:\/\//.test(a));
  const base = (arg ?? process.env.LIVE_SITE_URL ?? (domainOf(cfg) ? `https://${domainOf(cfg)}` : '')).replace(/\/+$/, '');
  if (!/^G-[A-Z0-9]{4,}$/.test(String(cfg.analytics?.ga4MeasurementId ?? ''))) {
    console.log('audit:ga: skipped: factory.config.json → analytics.ga4MeasurementId is empty, so the site sends nothing to GA4');
  } else if (!base) {
    console.error('audit:ga: no site URL (pass https://<domain>, or set LIVE_SITE_URL or project.domain)');
    process.exitCode = 2;
  } else {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const failures = [];
    const check = (ok, what) => (ok ? console.log(`  ok    ${what}`) : (failures.push(what), console.log(`  FAIL  ${what}`)));
    const visit = async (timezoneId, steps) => {
      const ctx = await browser.newContext({ timezoneId, locale: 'en-US' });
      await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
      const hits = [];
      let loads = 0;
      await ctx.route(/\/g\/collect/, async (route) => {
        hits.push({ url: route.request().url(), body: route.request().postData() });
        await route.abort();
      });
      ctx.on('request', (r) => { if (/googletagmanager\.com\/gtag\/js/.test(r.url())) loads++; });
      const page = await ctx.newPage();
      const out = await steps(page, () => ({ events: eventsOf(hits), loads }));
      await ctx.close();
      return out;
    };
    console.log(`audit:ga: ${base}`);
    try {
      const us = await visit('America/New_York', async (page, state) => {
        await page.goto(`${base}/?q=${SENTINEL}`, { waitUntil: 'load' });
        await page.waitForTimeout(5000);
        const banner = await page.locator('[data-consent-banner]').isVisible().catch(() => false);
        const href = await page.locator('main a[href^="/"]').first().getAttribute('href');
        await page.locator(`main a[href="${href}"]`).first().click();
        await page.waitForURL(`**${href}`);
        await page.waitForTimeout(6000);
        return { banner, href, ...state() };
      });
      check(!us.banner, 'outside Europe: no banner (opt-out through Cookie settings)');
      check(us.loads > 0, 'outside Europe: gtag.js loads');
      for (const p of visitProblems(us.events, { first: `${base}/`, second: `${base}${us.href}` })) check(false, p);
      if (!failures.length) check(true, 'no query strings or sentinel in hits; one titled page_view per navigation');
      const eu = await visit('Europe/Paris', async (page, state) => {
        await page.goto(`${base}/`, { waitUntil: 'load' });
        await page.waitForTimeout(4000);
        const banner = await page.locator('[data-consent-banner]').isVisible().catch(() => false);
        const before = state();
        if (banner) await page.getByRole('button', { name: 'Accept' }).click();
        await page.waitForTimeout(6000);
        return { banner, before, after: state() };
      });
      check(eu.banner, 'Europe: the consent banner shows');
      check(eu.before.loads === 0 && eu.before.events.length === 0, 'Europe: nothing loads or is sent before Accept');
      check(eu.after.loads > 0 && eu.after.events.some((e) => e.en === 'page_view'), 'Europe: after Accept, GA4 loads and sends a page view');
    } finally {
      await browser.close();
    }
    console.log(failures.length ? `audit:ga: FAIL, ${failures.length} failure(s)` : 'audit:ga: OK');
    process.exitCode = failures.length ? 1 : 0;
  }
}
