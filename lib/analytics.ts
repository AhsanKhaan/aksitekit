/**
 * GA4 helpers: nothing a visitor types ever reaches analytics.
 * - Addresses go out without their query string or hash.
 * - Events are allow-listed, and every parameter is a slug (a tool's id), never a value or a result.
 * Every gtag event goes through `track`; tests/analytics.test.ts fails if anything else calls gtag directly.
 */
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** origin + path only. */
export function cleanUrl(href: string): string {
  try {
    const u = new URL(href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? `${u.origin}${u.pathname}` : '';
  } catch {
    return '';
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVENTS = { tool_used: ['tool'] } as const;
export type AnalyticsEvent = keyof typeof EVENTS;

/** The parameters that may be sent: every allow-listed key, each a slug of at most 64 characters; otherwise nothing. */
export function eventParams(name: AnalyticsEvent, params: Record<string, string>): Record<string, string> | null {
  const keys = EVENTS[name];
  if (!keys) return null;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = params[k];
    if (typeof v !== 'string' || v.length > 64 || !SLUG.test(v)) return null;
    out[k] = v;
  }
  return out;
}

/** Send an allow-listed event if GA4 is running (it only runs with consent, in a production build). */
export function track(name: AnalyticsEvent, params: Record<string, string>): void {
  const p = eventParams(name, params);
  if (p && typeof window !== 'undefined' && typeof window.gtag === 'function') window.gtag('event', name, p);
}

/** On an in-site navigation the title changes a moment after the address: wait while it's empty or still the old one. */
export function titleSettled(title: string, previousTitle: string, firstView: boolean): boolean {
  return firstView || (title !== '' && title !== previousTitle);
}

/** A page view's fields, all without query strings. */
export function pageView(href: string, title: string, previous: string): { page_location: string; page_title: string; page_referrer: string } {
  return { page_location: cleanUrl(href), page_title: title.slice(0, 120), page_referrer: cleanUrl(previous) };
}
