import { SITE, absoluteUrl, authorPath } from '@/lib/site';
import type { Page } from '@/lib/registry';

/**
 * JSON-LD for each page type (HANDBOOK §8): WebSite and Organization on the home page; WebPage, CollectionPage,
 * WebApplication or Article for the page itself; BreadcrumbList everywhere; FAQPage when the page answers questions;
 * Person on the author page. No self-made ratings or reviews. Every node has an @type (the SEO gate checks it).
 */
type Node = Record<string, unknown>;

// Built from code points, so no editor or tool can turn the escapes back into the characters they stand for.
const UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const BACKSLASH = String.fromCharCode(92);

/**
 * JSON for a <script type="application/ld+json"> block. "<" becomes \u003c, so no string in the data can close the
 * script tag ("</script>") or open a comment; U+2028 and U+2029 are escaped for old parsers. The JSON stays valid.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(UNSAFE, (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export const organization = (): Node => ({ '@type': 'Organization', '@id': `${SITE.url}/#organization`, name: SITE.name, url: `${SITE.url}/` });
export const website = (description: string): Node => ({ '@type': 'WebSite', '@id': `${SITE.url}/#website`, name: SITE.name, url: `${SITE.url}/`, description, publisher: { '@id': `${SITE.url}/#organization` }, inLanguage: SITE.locale });
export const person = (): Node => ({ '@type': 'Person', '@id': `${absoluteUrl(authorPath)}#person`, name: SITE.author.name, url: absoluteUrl(authorPath) });

export function breadcrumbList(trail: { name: string; path: string }[]): Node {
  return { '@type': 'BreadcrumbList', itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: absoluteUrl(t.path) })) };
}

/** The page's own node: what it is, when it changed, who stands behind it. */
export function pageNode(p: Pick<Page, 'kind' | 'url' | 'h1' | 'description' | 'updated' | 'published'>): Node {
  const base: Node = {
    '@id': `${absoluteUrl(p.url)}#page`,
    url: absoluteUrl(p.url),
    name: p.h1,
    description: p.description,
    dateModified: p.updated,
    ...(p.published ? { datePublished: p.published } : {}),
    inLanguage: SITE.locale,
    isPartOf: { '@id': `${SITE.url}/#website` },
  };
  switch (p.kind) {
    case 'home':
    case 'category':
    case 'hub':
      return { ...base, '@type': 'CollectionPage' };
    case 'tool':
    case 'instance':
      return { ...base, '@type': 'WebApplication', applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', isAccessibleForFree: true, author: person() };
    case 'guide':
      return { ...base, '@type': 'Article', headline: p.h1, author: person(), publisher: { '@id': `${SITE.url}/#organization` } };
  }
}

export const faqPage = (faq: { q: string; a: string }[]): Node => ({
  '@type': 'FAQPage',
  mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') } })),
});

/** Trust and author pages: a WebPage (AboutPage or ContactPage where schema.org has one). */
export function trustNode(path: string, name: string, description: string, type = 'WebPage'): Node {
  return { '@type': type, '@id': `${absoluteUrl(path)}#page`, url: absoluteUrl(path), name, description, dateModified: SITE.trustUpdated, inLanguage: SITE.locale, isPartOf: { '@id': `${SITE.url}/#website` } };
}

export const graph = (...nodes: Node[]): Node => ({ '@context': 'https://schema.org', '@graph': nodes });
