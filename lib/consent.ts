/**
 * Analytics consent with the site's own banner (no third-party script).
 * - A browser set to a European time zone (EEA, UK, Switzerland, or a masked or unknown zone) sees the banner, and
 *   GA4 waits for "Accept" (opt-in).
 * - Everyone else is counted by default and can switch it off with "Cookie settings" in the footer (opt-out).
 * - Backstop: Consent Mode's region default keeps analytics storage denied for EEA, UK and Swiss addresses.
 * Ad storage is always denied here. Ads need a Google-certified consent platform instead (scripts/adsense-gate.mjs).
 */
export type ConsentChoice = 'granted' | 'denied';

/** The one storage key: "<choice>:<yyyy-mm-dd>". */
export const CONSENT_KEY = 'site-consent';
/** A choice is asked again after a year. */
export const CONSENT_MAX_DAYS = 365;
/** The window event the footer's "Cookie settings" button sends to reopen the banner. */
export const OPEN_CONSENT_SETTINGS = 'site:consent-settings';

/** EEA (EU 27, Iceland, Liechtenstein, Norway), the UK and Switzerland: ISO 3166-1 codes for Consent Mode's region default. */
export const CONSENT_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
] as const;

// European territories whose time zones don't start with "Europe/" (Canaries, Azores, Cyprus, outermost regions…).
const EUROPEAN_ZONES = new Set([
  'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores', 'Atlantic/Reykjavik', 'Atlantic/Faroe', 'Arctic/Longyearbyen',
  'Asia/Nicosia', 'Asia/Famagusta', 'Africa/Ceuta', 'America/Cayenne', 'America/Guadeloupe', 'America/Martinique',
  'Indian/Reunion', 'Indian/Mayotte',
]);

/** Ask first when the time zone is European, unknown, or masked as UTC (privacy browsers report UTC). */
export function needsOptIn(timeZone: string | undefined): boolean {
  if (!timeZone) return true;
  return timeZone.startsWith('Europe/') || EUROPEAN_ZONES.has(timeZone) || timeZone === 'UTC' || timeZone.startsWith('Etc/');
}

const DAY = 86_400_000;

/** A stored value back to a choice: only "granted|denied:<date>" within CONSENT_MAX_DAYS of today; anything else asks again. */
export function parseConsent(raw: string | null, today: string): ConsentChoice | null {
  const m = /^(granted|denied):(\d{4}-\d{2}-\d{2})$/.exec(raw ?? '');
  if (!m) return null;
  const age = (Date.parse(today) - Date.parse(m[2]!)) / DAY;
  return Number.isFinite(age) && age >= 0 && age <= CONSENT_MAX_DAYS ? (m[1] as ConsentChoice) : null;
}

export function readConsent(today: string): ConsentChoice | null {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_KEY), today);
  } catch {
    return null;
  }
}

export function writeConsent(choice: ConsentChoice, today: string): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, `${choice}:${today}`);
  } catch {
    // Storage blocked: the choice holds for this page view only.
  }
}

/** What analytics may do for this visitor: load GA4, and whether to show the banner. */
export function analyticsState(choice: ConsentChoice | null, optInRegion: boolean): { load: boolean; banner: boolean } {
  if (choice === 'denied') return { load: false, banner: false };
  if (choice === 'granted') return { load: true, banner: false };
  return optInRegion ? { load: false, banner: true } : { load: true, banner: false };
}

/** The visitor's local date, YYYY-MM-DD. */
export const localTodayIso = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
