import Link from 'next/link';
import { SITE, authorPath } from '@/lib/site';

/** Who wrote the page and when its text last changed (the date changes only when the text does). */
export default function Byline({ updated }: { updated: string }) {
  const date = new Date(`${updated}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  return (
    <p className="byline">
      By <Link href={authorPath}>{SITE.author.name}</Link>
      {' · '}
      Updated <time dateTime={updated}>{date}</time>
    </p>
  );
}
