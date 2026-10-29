import Link from 'next/link';
import Sections from '@/components/Blocks';
import Breadcrumbs from '@/components/Breadcrumbs';
import Byline from '@/components/Byline';
import ExampleNotice from '@/components/ExampleNotice';
import Faq from '@/components/Faq';
import Inline from '@/components/Inline';
import JsonLd from '@/components/JsonLd';
import PageList from '@/components/PageList';
import Sources from '@/components/Sources';
import { TOOLS } from '@/components/tools';
import { breadcrumbs, childrenOf, registry, related, topLevel, type Page } from '@/lib/registry';
import { breadcrumbList, faqPage, graph, organization, pageNode, website } from '@/lib/seo/jsonld';

/**
 * One template for every registry page: home, category hub, tool, guide, hub and instance. The text comes from the
 * page's content file; the lists (a category's pages, a hub's children, related pages) come from the registry, so
 * every page has its inbound links and nothing is more than 3 clicks from home.
 */
export default function ContentPage({ page }: { page: Page }) {
  const r = registry();
  const trail = breadcrumbs(r, page.url);
  const Tool = page.tool ? TOOLS[page.tool] : undefined;
  if (page.tool && !Tool) throw new Error(`${page.url}: no tool component "${page.tool}" in components/tools/index.ts`);
  const children = page.kind === 'tool' || page.kind === 'hub' ? childrenOf(r, page.url) : [];
  const listed = page.kind === 'category' ? topLevel(r, page.category) : [];
  const parent = page.parent ? r.byUrl.get(page.parent) : undefined;
  const others = page.kind === 'home' || page.kind === 'category' ? [] : related(r, page);
  const ld = graph(
    ...(page.kind === 'home' ? [organization(), website(page.description)] : []),
    pageNode(page),
    breadcrumbList(trail),
    ...(page.faq?.length ? [faqPage(page.faq)] : []),
  );

  return (
    <>
      <JsonLd data={ld} />
      {page.kind !== 'home' ? <Breadcrumbs trail={trail} /> : null}
      <article>
        {page.example ? <ExampleNotice /> : null}
        <h1>{page.h1}</h1>
        {page.kind !== 'home' && page.kind !== 'category' ? <Byline updated={page.updated} /> : null}
        {page.intro.map((t, i) => (
          <p key={i} className={i === 0 ? 'lead' : undefined}>
            <Inline text={t} />
          </p>
        ))}
        {page.answer ? (
          <p className="answer">
            <span>{page.answer.label}</span> <strong>{page.answer.value}</strong>
          </p>
        ) : null}
        {Tool ? <Tool preset={page.toolPreset} /> : null}
        {page.kind === 'home' ? (
          r.categories.map((c) => (
            <section key={c.url} aria-labelledby={`cat-${c.category}`}>
              <h2 id={`cat-${c.category}`}>
                <Link href={c.url}>{c.name}</Link>
              </h2>
              <p>{c.description}</p>
              <PageList label={c.name} pages={r.pages.filter((p) => p.category === c.category)} />
            </section>
          ))
        ) : null}
        {listed.length ? (
          <section aria-labelledby="in-category">
            <h2 id="in-category">{`Pages in ${page.name}`}</h2>
            <PageList label={page.name} pages={listed.flatMap((p) => [p, ...childrenOf(r, p.url)])} />
          </section>
        ) : null}
        <Sections sections={page.sections} />
        {children.length ? (
          <section aria-labelledby="go-further">
            <h2 id="go-further">{page.kind === 'hub' ? 'Read next' : 'Worked answers'}</h2>
            <PageList label={page.h1} pages={children} />
          </section>
        ) : null}
        {page.faq?.length ? <Faq faq={page.faq} /> : null}
        {page.sources?.length ? <Sources sources={page.sources} /> : null}
      </article>
      {parent || others.length ? (
        <aside className="related" aria-label="Related pages">
          <p className="related-title">Related</p>
          <ul>
            {parent ? (
              <li>
                <Link href={parent.url}>{parent.h1}</Link>
              </li>
            ) : null}
            {others.map((p) => (
              <li key={p.url}>
                <Link href={p.url}>{p.h1}</Link>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </>
  );
}
