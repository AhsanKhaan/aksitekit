import Breadcrumbs from '@/components/Breadcrumbs';
import ExampleNotice from '@/components/ExampleNotice';
import JsonLd from '@/components/JsonLd';
import { SITE } from '@/lib/site';
import { breadcrumbList, graph, trustNode } from '@/lib/seo/jsonld';

/**
 * About, Contact, Privacy, Terms, Editorial policy and the author page. data-trust-page puts them under "Optional"
 * in llms.txt. While content/site.json holds the template's example people, the page carries the example notice.
 */
export default function TrustPage({ path, name, description, type, children }: { path: string; name: string; description: string; type?: string; children: React.ReactNode }) {
  const date = new Date(`${SITE.trustUpdated}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const trail = [{ name: 'Home', path: '/' }, { name, path }];
  return (
    <>
      <JsonLd data={graph(trustNode(path, name, description, type), breadcrumbList(trail))} />
      <Breadcrumbs trail={trail} />
      <article data-trust-page="">
        {SITE.example ? <ExampleNotice /> : null}
        <h1>{name}</h1>
        <p className="byline">
          Last updated <time dateTime={SITE.trustUpdated}>{date}</time>
        </p>
        {children}
      </article>
    </>
  );
}
