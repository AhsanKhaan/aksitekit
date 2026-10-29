import Link from 'next/link';
import { notFound } from 'next/navigation';
import JsonLd from '@/components/JsonLd';
import TrustPage from '@/components/TrustPage';
import { registry } from '@/lib/registry';
import { SITE, absoluteUrl, authorPath } from '@/lib/site';
import { person } from '@/lib/seo/jsonld';
import { pageMetadata, titleFor } from '@/lib/seo/metadata';

type Params = Promise<{ author: string }>;
export const dynamicParams = false;
export const generateStaticParams = () => [{ author: SITE.author.slug }];

const description = `${SITE.author.name}: ${SITE.author.role.toLowerCase()} on ${SITE.name}. What they know, how they check each page, and how to reach them.`.slice(0, 160);

export async function generateMetadata({ params }: { params: Params }) {
  if ((await params).author !== SITE.author.slug) return {};
  return pageMetadata({ title: titleFor(`${SITE.author.name}, author at ${SITE.name}`, `${SITE.author.name}: about the author`, SITE.author.name), description, path: authorPath });
}

/** The person behind the content (AdSense and readers look for one): their bio and every page they wrote. */
export default async function Author({ params }: { params: Params }) {
  if ((await params).author !== SITE.author.slug) notFound();
  const { pages, categories } = registry();
  return (
    <TrustPage path={authorPath} name={SITE.author.name} description={description} type="ProfilePage">
      <JsonLd data={{ '@context': 'https://schema.org', ...person(), jobTitle: SITE.author.role, worksFor: { '@type': 'Organization', name: SITE.name, url: absoluteUrl('/') } }} />
      <p className="lead">{SITE.author.role}.</p>
      {SITE.author.bio.map((t, i) => (
        <p key={i}>{t}</p>
      ))}
      <h2>Pages written and checked</h2>
      <ul>
        {[...categories, ...pages].map((p) => (
          <li key={p.url}>
            <Link href={p.url}>{p.h1}</Link>
          </li>
        ))}
      </ul>
      <h2>How to reach the author</h2>
      <p>
        Questions and corrections go through the <Link href="/contact/">contact page</Link>. The{' '}
        <Link href="/editorial-policy/">editorial policy</Link> explains how each page is checked before it goes live.
      </p>
    </TrustPage>
  );
}
