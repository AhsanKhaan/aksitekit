import Link from 'next/link';

/** A list of pages with their one-line descriptions (category hubs, the home page, a hub's children). */
export default function PageList({ pages, label }: { pages: { url: string; h1: string; description: string }[]; label: string }) {
  return (
    <ul className="page-list" aria-label={label}>
      {pages.map((p) => (
        <li key={p.url}>
          <Link href={p.url}>{p.h1}</Link>
          <p>{p.description}</p>
        </li>
      ))}
    </ul>
  );
}
