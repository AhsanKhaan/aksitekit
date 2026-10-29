import type { Metadata } from 'next';
import { SITE, absoluteUrl } from '@/lib/site';
import { ogImagePath } from '@/lib/seo/og';

/**
 * Per-page metadata: one title and description, an absolute self-canonical with a trailing slash, a share card, and
 * robots "index, follow" only in an indexable build. `held` keeps one page out of search in every build with
 * "noindex, follow" (no other page uses it, so check-out.mjs and the sitemap can tell it apart).
 */
export function pageMetadata(p: { title: string; description: string; path: string; held?: boolean }): Metadata {
  const image = { url: absoluteUrl(ogImagePath(p.path)), width: 1200, height: 630, alt: p.title, type: 'image/png' };
  return {
    title: { absolute: p.title },
    description: p.description,
    alternates: { canonical: absoluteUrl(p.path) },
    robots: p.held ? { index: false, follow: true } : SITE.indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: 'website', siteName: SITE.name, locale: SITE.locale.replace('-', '_'), url: absoluteUrl(p.path), title: p.title, description: p.description, images: [image] },
    twitter: { card: 'summary_large_image', title: p.title, description: p.description, images: [image.url] },
  };
}

/** The first title that fits in 60 characters (the SEO gate's limit), so a long site name never cuts one mid-word. */
export const titleFor = (...options: string[]): string => options.find((t) => t.length <= 60) ?? options.at(-1)!.slice(0, 60);
