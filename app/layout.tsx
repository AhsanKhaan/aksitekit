import type { Metadata, Viewport } from 'next';
import './globals.css';
import Analytics from '@/components/Analytics';
import SiteFooter from '@/components/SiteFooter';
import SiteHeader from '@/components/SiteHeader';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  applicationName: SITE.name,
  // No site-wide robots: every page sets its own (index only in an indexable build), and the 404 page keeps Next's
  // single "noindex". Setting `icons` replaces the link Next would generate, so the favicon is listed here.
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={SITE.locale}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="wrap">
          {children}
        </main>
        <SiteFooter />
        {SITE.ga4Id ? <Analytics gaId={SITE.ga4Id} host={SITE.host} /> : null}
      </body>
    </html>
  );
}
