import Link from 'next/link';
import { registry } from '@/lib/registry';

export const metadata = { title: 'Page not found', description: 'There is no page at this address.' };

/** out/404.html: a real 404 status from the host, with a way back to the pages that exist. */
export default function NotFound() {
  const { categories } = registry();
  return (
    <article>
      <h1>Page not found</h1>
      <p>There is no page at this address. It may have moved, or the link may have a typo.</p>
      <ul>
        <li>
          <Link href="/">Home page</Link>
        </li>
        {categories.map((c) => (
          <li key={c.url}>
            <Link href={c.url}>{c.name}</Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
