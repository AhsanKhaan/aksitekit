import { notFound } from 'next/navigation';
import ContentPage from '@/components/ContentPage';
import { registry } from '@/lib/registry';
import { pageMetadata } from '@/lib/seo/metadata';

type Params = Promise<{ category: string; slug: string }>;
export const dynamicParams = false;

/** Tools, guides and hubs: /{category}/{slug}/. */
export function generateStaticParams() {
  return registry().pages.filter((p) => !p.parent).map((p) => {
    const [category, slug] = p.url.split('/').filter(Boolean) as [string, string];
    return { category, slug };
  });
}

const find = async (params: Params) => {
  const { category, slug } = await params;
  return registry().byUrl.get(`/${category}/${slug}/`);
};

export async function generateMetadata({ params }: { params: Params }) {
  const p = await find(params);
  return p ? pageMetadata({ title: p.title, description: p.description, path: p.url }) : {};
}

export default async function TopLevelPage({ params }: { params: Params }) {
  const p = await find(params);
  if (!p) notFound();
  return <ContentPage page={p} />;
}
