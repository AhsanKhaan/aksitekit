import Link from 'next/link';
import { registry } from '@/lib/registry';
import { SITE } from '@/lib/site';

/** The site name and the main navigation: every category, then About. One text node per link (no run-together anchors). */
export default function SiteHeader() {
  const { categories } = registry();
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link href="/" className="brand">
          {SITE.name}
        </Link>
        <nav aria-label="Main">
          <ul className="nav-list">
            {categories.map((c) => (
              <li key={c.url}>
                <Link href={c.url}>{c.name}</Link>
              </li>
            ))}
            <li>
              <Link href="/about/">About</Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
