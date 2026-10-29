'use client';

import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import type { ConsentChoice } from '@/lib/consent';

/**
 * The site's own consent banner: plain words, two equal buttons, nothing pre-chosen, and a way back in through
 * "Cookie settings" in the footer. Fixed to the bottom, so it never moves the page (no layout shift).
 */
export default function ConsentBanner({ current, onChoose }: { current: ConsentChoice | null; onChoose: (choice: ConsentChoice) => void }) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // Keep the page's last lines and any focused field clear of the banner (WCAG 2.2 Focus Not Obscured).
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const fit = () => root.style.setProperty('--consent-h', `${el.offsetHeight + 24}px`);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    root.classList.add('has-consent');
    return () => {
      observer.disconnect();
      root.classList.remove('has-consent');
      root.style.removeProperty('--consent-h');
    };
  }, []);

  return (
    <section ref={ref} className="consent" aria-labelledby={`${id}-title`} data-consent-banner="">
      <p id={`${id}-title`} className="consent-title">
        Can we count your visit?
      </p>
      <p>
        We&apos;d like to use Google Analytics cookies to see which pages people read, so we know what to improve. It
        never receives what you type into a tool.{' '}
        {current ? <strong>Analytics is {current === 'granted' ? 'on' : 'off'} for you. </strong> : null}
        Change your mind any time with Cookie settings at the bottom of every page. <Link href="/privacy/">Privacy policy</Link>
      </p>
      <div className="consent-buttons">
        <button type="button" onClick={() => onChoose('denied')}>
          Decline
        </button>
        <button type="button" onClick={() => onChoose('granted')}>
          Accept
        </button>
      </div>
    </section>
  );
}
