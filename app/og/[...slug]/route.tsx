import { ImageResponse } from 'next/og';
import { registry } from '@/lib/registry';
import { SITE, authorPath } from '@/lib/site';
import { clip, ogImagePath } from '@/lib/seo/og';

// Share images (Open Graph and X), one 1200 × 630 PNG per page, written to out/og/… by the static export. Drawn with
// next/og, which is part of Next.js: no extra package and no network at build time.
export const dynamic = 'force-static';
export const dynamicParams = false;

const TRUST = [
  { path: '/about/', title: `About ${SITE.name}` },
  { path: '/contact/', title: 'Contact' },
  { path: '/privacy/', title: 'Privacy policy' },
  { path: '/terms/', title: 'Terms of use' },
  { path: '/editorial-policy/', title: 'Editorial policy' },
];

function cards() {
  const r = registry();
  return [
    { path: '/', title: r.home.h1, subtitle: clip(r.home.description, 110) },
    ...r.categories.map((c) => ({ path: c.url, eyebrow: 'Topic', title: c.h1, subtitle: clip(c.description, 110) })),
    ...r.pages.map((p) => ({ path: p.url, eyebrow: r.byUrl.get(`/${p.category}/`)?.name ?? '', title: p.h1, subtitle: clip(p.description, 110) })),
    ...TRUST.map((t) => ({ path: t.path, eyebrow: SITE.name, title: t.title })),
    { path: authorPath, eyebrow: 'Author', title: SITE.author.name },
  ] as { path: string; eyebrow?: string; title: string; subtitle?: string }[];
}

export function generateStaticParams() {
  return cards().map((c) => ({ slug: ogImagePath(c.path).replace(/^\/og\//, '').split('/') }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const path = `/og/${(await params).slug.join('/')}`;
  const card = cards().find((c) => ogImagePath(c.path) === path);
  if (!card) return new Response('Not found', { status: 404 });
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', background: '#ffffff', color: '#111827', borderTop: '16px solid #1d4ed8' }}>
        <div style={{ display: 'flex', fontSize: 34, color: '#1d4ed8' }}>{SITE.name}</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {card.eyebrow ? <div style={{ fontSize: 28, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 18 }}>{card.eyebrow}</div> : null}
          <div style={{ fontSize: card.title.length > 34 ? 64 : 80, lineHeight: 1.08 }}>{card.title}</div>
          {card.subtitle ? <div style={{ fontSize: 31, color: '#4b5563', lineHeight: 1.35, marginTop: 22 }}>{card.subtitle}</div> : null}
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: '#4b5563' }}>{SITE.host}</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
