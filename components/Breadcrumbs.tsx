import Link from 'next/link';

/** Breadcrumbs mirror the URL (Home › Category › Page); the current page is text, not a link. */
export default function Breadcrumbs({ trail }: { trail: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {trail.map((t, i) => (
          <li key={t.path}>{i < trail.length - 1 ? <Link href={t.path}>{t.name}</Link> : <span aria-current="page">{t.name}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}
