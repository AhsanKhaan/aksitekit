import { notFound } from 'next/navigation';
import ContentPage from '@/components/ContentPage';
import { registry } from '@/lib/registry';
import { pageMetadata } from '@/lib/seo/metadata';

type Params = Promise<{ category: string; slug: string; child: string }>;
export const dynamicParams = false;

/** Guides and instances under a tool or hub: /{category}/{slug}/{child}/ (the deepest level allowed). */
export function generateStaticParams() {
  return registry().pages.filter((p) => p.parent).map((p) => {
    const [category, slug, child] = p.url.split('/').filter(Boolean) as [string, string, string];
    return { category, slug, child };
  });
}

const find = async (params: Params) => {
  const { category, slug, child } = await params;
  return registry().byUrl.get(`/${category}/${slug}/${child}/`);
};

export async function generateMetadata({ params }: { params: Params }) {
  const p = await find(params);
  return p ? pageMetadata({ title: p.title, description: p.description, path: p.url }) : {};
}

export default async function ChildPage({ params }: { params: Params }) {
  const p = await find(params);
  if (!p) notFound();
  return <ContentPage page={p} />;
}
