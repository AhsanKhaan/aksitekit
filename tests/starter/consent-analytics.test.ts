// Consent (lib/consent.ts) and analytics (lib/analytics.ts): who is asked first, how long a choice lasts, and that
// nothing a visitor types reaches GA4.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSENT_REGIONS, analyticsState, needsOptIn, parseConsent } from '@/lib/consent';
import { cleanUrl, eventParams, pageView, titleSettled } from '@/lib/analytics';

const REPO = path.resolve(__dirname, '..', '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)]));

describe('consent', () => {
  it('asks first in Europe, in European territories outside Europe/, and when the zone is hidden', () => {
    for (const tz of ['Europe/Berlin', 'Europe/London', 'Atlantic/Canary', 'Asia/Nicosia', 'UTC', 'Etc/GMT', undefined]) expect(needsOptIn(tz), String(tz)).toBe(true);
    for (const tz of ['America/New_York', 'Asia/Karachi', 'Australia/Sydney']) expect(needsOptIn(tz), tz).toBe(false);
  });

  it('keeps a choice for a year, then asks again', () => {
    expect(parseConsent('granted:2026-01-01', '2026-12-31')).toBe('granted');
    expect(parseConsent('denied:2025-01-01', '2026-10-29')).toBeNull();
    expect(parseConsent('granted:2026-11-01', '2026-10-29')).toBeNull(); // a date in the future is not trusted
    expect(parseConsent('yes', '2026-10-29')).toBeNull();
    expect(parseConsent(null, '2026-10-29')).toBeNull();
  });

  it('loads GA4 only with consent in opt-in regions, and never after a refusal', () => {
    expect(analyticsState(null, true)).toEqual({ load: false, banner: true });
    expect(analyticsState(null, false)).toEqual({ load: true, banner: false });
    expect(analyticsState('denied', false)).toEqual({ load: false, banner: false });
    expect(analyticsState('granted', true)).toEqual({ load: true, banner: false });
  });

  it('lists the EEA, the UK and Switzerland for the region default', () => {
    expect(CONSENT_REGIONS).toHaveLength(32);
    expect(CONSENT_REGIONS).toEqual(expect.arrayContaining(['DE', 'FR', 'GB', 'CH', 'NO', 'IS', 'LI']));
  });
});

describe('analytics', () => {
  it('drops query strings and fragments from every address (planted: a search term in the URL)', () => {
    expect(cleanUrl('https://example.com/a/?q=my+secret#top')).toBe('https://example.com/a/');
    expect(cleanUrl('javascript:alert(1)')).toBe('');
    expect(pageView('https://example.com/a/?x=1', 'T', 'https://example.com/?ref=2')).toEqual({ page_location: 'https://example.com/a/', page_title: 'T', page_referrer: 'https://example.com/' });
  });

  it('sends allow-listed slugs only, never a typed value (planted: free text as the tool id)', () => {
    expect(eventParams('tool_used', { tool: 'length-checker' })).toEqual({ tool: 'length-checker' });
    expect(eventParams('tool_used', { tool: 'How the starter site is planned' })).toBeNull();
    expect(eventParams('tool_used', { tool: 'length-checker', text: 'what they typed' })).toEqual({ tool: 'length-checker' });
    expect(eventParams('tool_used', {})).toBeNull();
  });

  it('waits for the new title after an in-site navigation', () => {
    expect(titleSettled('', 'Old', false)).toBe(false);
    expect(titleSettled('Old', 'Old', false)).toBe(false);
    expect(titleSettled('New', 'Old', false)).toBe(true);
    expect(titleSettled('', '', true)).toBe(true);
  });

  it('no code outside the analytics helpers and their loader touches gtag', () => {
    const files = ['app', 'components', 'lib'].flatMap((d) => walk(path.join(REPO, d))).filter((f) => /\.(?:ts|tsx)$/.test(f));
    const allowed = new Set([path.join(REPO, 'lib', 'analytics.ts'), path.join(REPO, 'components', 'Analytics.tsx')]);
    const offenders = files.filter((f) => !allowed.has(f) && /\bgtag\b/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(REPO, f))).toEqual([]);
    const loader = readFileSync(path.join(REPO, 'components', 'Analytics.tsx'), 'utf8');
    expect([...loader.matchAll(/gtag\?*\.?\(\s*'event',\s*'([a-z_]+)'/g)].map((m) => m[1])).toEqual(['page_view']);
  });
});
