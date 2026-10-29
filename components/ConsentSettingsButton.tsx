'use client';

import { OPEN_CONSENT_SETTINGS } from '@/lib/consent';

/** Footer "Cookie settings": reopens the consent banner on any page, so consent is as easy to withdraw as to give. */
export default function ConsentSettingsButton() {
  return (
    <button type="button" className="linkish" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_SETTINGS))}>
      Cookie settings
    </button>
  );
}
