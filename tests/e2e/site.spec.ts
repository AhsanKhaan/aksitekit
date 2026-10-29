// End-to-end checks on the built site (npm run build first), served by scripts/serve-out.mjs with the _headers rules:
// every page loads with no console, page or CSP errors and no outside requests, nothing scrolls sideways from 320 to
// 1280 px, standalone controls are 44 × 44 px, the skip link works, the example tool works, and consent behaves.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const REPO = path.resolve(__dirname, '..', '..');
const factory = JSON.parse(readFileSync(path.join(REPO, 'factory.config.json'), 'utf8'));
const OUT = path.join(REPO, process.env.SITE_OUT || factory.build.outputDir || 'out');
const sitemap = existsSync(path.join(OUT, 'sitemap.xml')) ? readFileSync(path.join(OUT, 'sitemap.xml'), 'utf8') : '';
const PATHS = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]!);
const WIDTHS = [320, 375, 768, 1024, 1280];
const TARGETS = '.nav-list a, .footer-links a, .footer-links button, .breadcrumbs a, .related a, .page-list a, .brand, .choice label, .tool input:not([type=radio]), .tool textarea, button';

test.beforeAll(() => {
  expect(PATHS.length, `no pages in ${OUT}/sitemap.xml: run npm run build first`).toBeGreaterThan(0);
});

/** Console errors, uncaught errors, CSP violations and requests to other origins while a page loads. */
async function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost') && !r.url().startsWith('data:')) problems.push(`outside request: ${r.url()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`));
  });
  return problems;
}

for (const p of PATHS) {
  test(`${p} loads cleanly`, async ({ page }) => {
    const problems = await watch(page);
    const res = await page.goto(p, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
    expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
    await expect(page.locator('h1')).toHaveCount(1);
    expect(problems).toEqual([]);
  });

  test(`${p} has no horizontal scroll from 320 to 1280 px`, async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(p);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${width} px`).toBeLessThanOrEqual(0);
    }
  });

  test(`${p} keeps standalone controls at 44 × 44 px on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(p);
    const small = await page.$$eval(TARGETS, (els) =>
      els.map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.height < 44 || r.width < 44))
        .map(({ el, r }) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`),
    );
    expect(small).toEqual([]);
  });
}

test('the 404 page answers 404 and stays out of search', async ({ page }) => {
  const res = await page.goto('/no-such-page/');
  expect(res?.status()).toBe(404);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('h1')).toHaveCount(1);
});

test('the skip link moves focus to the content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('the example tool checks a title and a description as you type', async ({ page }) => {
  const problems = await watch(page);
  await page.goto('/handbook/length-checker/');
  const result = page.locator('output.result');
  await expect(result).toContainText('47 characters, 7 words: inside the range (30–60)');
  const box = page.getByLabel('Text to check');
  await box.fill('Too short');
  await expect(result).toContainText('9 characters, 2 words: 21 short of the minimum (30–60)');
  await page.getByLabel(/Meta description/).check();
  await expect(result).toContainText('61 short of the minimum (70–160)');
  await box.fill('');
  await expect(result).toContainText('Type or paste a meta description to check it.');
  expect(problems).toEqual([]);
});

test('the worked example starts from its preset', async ({ page }) => {
  await page.goto('/handbook/length-checker/sample-title/');
  await expect(page.locator('output.result')).toContainText('78 characters, 12 words: 18 over the maximum (30–60)');
});

const homeHtml = existsSync(path.join(OUT, 'index.html')) ? readFileSync(path.join(OUT, 'index.html'), 'utf8') : '';
const analyticsBuilt = /googletagmanager\.com\/gtag\/js/.test(homeHtml) || /Cookie settings/.test(homeHtml);

test('without analytics there is no banner, no cookie and no request to Google', async ({ page, context }) => {
  test.skip(analyticsBuilt, 'this build runs analytics; the consent tests below cover it');
  const google: string[] = [];
  page.on('request', (r) => {
    if (/google/.test(r.url())) google.push(r.url());
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-consent-banner]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cookie settings' })).toHaveCount(0);
  expect(await context.cookies()).toEqual([]);
  expect(google).toEqual([]);
});

test.describe('consent (builds with analytics)', () => {
  test.skip(!analyticsBuilt, 'analytics is off in this build (no GA4 ID, or not an indexable production build)');
  test.use({ timezoneId: 'Europe/Berlin' });

  test('asks first in Europe, and loads nothing from Google until Accept', async ({ page }) => {
    const google: string[] = [];
    await page.route(/google/, (route) => {
      google.push(route.request().url());
      return route.abort();
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-consent-banner]')).toBeVisible();
    expect(google).toEqual([]);
    await page.getByRole('button', { name: 'Decline' }).click();
    await expect(page.locator('[data-consent-banner]')).toHaveCount(0);
    await page.reload({ waitUntil: 'networkidle' });
    expect(google).toEqual([]);
    await page.getByRole('button', { name: 'Cookie settings' }).click();
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(() => google.some((u) => /gtag\/js/.test(u))).toBe(true);
  });
});
