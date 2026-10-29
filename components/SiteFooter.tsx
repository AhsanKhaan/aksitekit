import Link from 'next/link';
import ConsentSettingsButton from '@/components/ConsentSettingsButton';
import { SITE, authorPath } from '@/lib/site';

export const TRUST_LINKS = [
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
  { href: '/privacy/', label: 'Privacy policy' },
  { href: '/terms/', label: 'Terms of use' },
  { href: '/editorial-policy/', label: 'Editorial policy' },
] as const;

/**
 * Every page links the trust pages, the author and llms.txt, and shows the disclaimer (the SEO and AdSense gates check
 * all of them on every page). "Cookie settings" appears only when the build runs analytics.
 */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <nav aria-label="Site">
          <ul className="footer-links">
            {TRUST_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
            <li>
              <Link href={authorPath}>{`Written by ${SITE.author.name}`}</Link>
            </li>
            <li>
              <a href="/llms.txt">llms.txt</a>
            </li>
            {SITE.ga4Id ? (
              <li>
                <ConsentSettingsButton />
              </li>
            ) : null}
          </ul>
        </nav>
        <p className="disclaimer">{SITE.disclaimer}</p>
        <p className="copyright">{`© ${new Date().getFullYear()} ${SITE.name}`}</p>
      </div>
    </footer>
  );
}
