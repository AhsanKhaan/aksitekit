'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import ConsentBanner from '@/components/ConsentBanner';
import { pageView, titleSettled } from '@/lib/analytics';
import { CONSENT_REGIONS, OPEN_CONSENT_SETTINGS, analyticsState, localTodayIso, needsOptIn, readConsent, writeConsent, type ConsentChoice } from '@/lib/consent';

const NO_ADS = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' } as const;

/** Only on the site's own host, never in an automated browser: previews and tests never send a hit. */
const liveSite = (host: string): boolean => window.location.host === host && !navigator.webdriver;

/** Queue GA4's setup before gtag.js arrives: consent defaults, then config without automatic page views. */
function startGtag(gaId: string, choice: ConsentChoice | null): void {
  (window as unknown as Record<string, boolean>)[`ga-disable-${gaId}`] = false;
  if (window.gtag) {
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    return;
  }
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js reads the Arguments object itself, not an array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', { ...NO_ADS, analytics_storage: 'denied', region: [...CONSENT_REGIONS], wait_for_update: 500 });
  window.gtag('consent', 'default', { ...NO_ADS, analytics_storage: 'granted' });
  if (choice === 'granted') window.gtag('consent', 'update', { analytics_storage: 'granted' });
  window.gtag('js', new Date());
  window.gtag('config', gaId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, ...pageView(window.location.href, document.title, document.referrer) });
}

/** Withdrawn consent: stop GA4 for this page and remove its cookies. */
function stopGtag(gaId: string): void {
  (window as unknown as Record<string, boolean>)[`ga-disable-${gaId}`] = true;
  window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
  const domain = `.${window.location.hostname.replace(/^www\./, '')}`;
  for (const name of ['_ga', `_ga_${gaId.replace(/^G-/, '')}`]) document.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`;
}

/**
 * Google Analytics 4 behind the site's own consent banner. Rendered only in an
 * indexable production build with a measurement ID (lib/site.ts). One page view per route, without query strings.
 */
export default function Analytics({ gaId, host }: { gaId: string; host: string }) {
  const pathname = usePathname();
  const [state, setState] = useState<{ load: boolean; banner: boolean; choice: ConsentChoice | null }>({ load: false, banner: false, choice: null });
  const previous = useRef('');
  const previousTitle = useRef('');

  useEffect(() => {
    const choice = readConsent(localTodayIso());
    const decided = analyticsState(choice, needsOptIn(Intl.DateTimeFormat().resolvedOptions().timeZone));
    const live = liveSite(host);
    if (live && decided.load) startGtag(gaId, choice);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-time read of the visitor's own browser storage
    setState({ load: live && decided.load, banner: live && decided.banner, choice });
    const open = () => setState((s) => ({ ...s, banner: true }));
    window.addEventListener(OPEN_CONSENT_SETTINGS, open);
    return () => window.removeEventListener(OPEN_CONSENT_SETTINGS, open);
  }, [gaId, host]);

  useEffect(() => {
    if (!state.load || !window.gtag) return;
    // Wait for the new page's <title> (at most about 2 s), so no page view goes out untitled.
    let tries = 0;
    let t = 0;
    const send = () => {
      if (!titleSettled(document.title, previousTitle.current, !previous.current) && tries++ < 40) {
        t = window.setTimeout(send, 50);
        return;
      }
      const view = pageView(window.location.href, document.title, previous.current || document.referrer);
      if (view.page_location === previous.current) return;
      window.gtag?.('set', { page_location: view.page_location, page_referrer: view.page_referrer });
      window.gtag?.('event', 'page_view', view);
      previous.current = view.page_location;
      previousTitle.current = document.title;
    };
    t = window.setTimeout(send, 0);
    return () => window.clearTimeout(t);
  }, [pathname, state.load]);

  const choose = (choice: ConsentChoice) => {
    writeConsent(choice, localTodayIso());
    const live = liveSite(host);
    if (choice === 'granted' && live) startGtag(gaId, 'granted');
    if (choice === 'denied') stopGtag(gaId);
    setState({ load: choice === 'granted' && live, banner: false, choice });
  };

  return (
    <>
      {state.load ? <Script id="ga4" src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`} strategy="lazyOnload" /> : null}
      {state.banner ? <ConsentBanner current={state.choice ?? (state.load ? 'granted' : null)} onChoose={choose} /> : null}
    </>
  );
}
