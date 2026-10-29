import { notFound } from 'next/navigation';
import ContentPage from '@/components/ContentPage';
import { registry } from '@/lib/registry';
import { pageMetadata } from '@/lib/seo/metadata';

type Params = Promise<{ category: string }>;
export const dynamicParams = false;

export function generateStaticParams() {
  return registry().categories.map((c) => ({ category: c.category }));
}

const find = async (params: Params) => registry().byUrl.get(`/${(await params).category}/`);

export async function generateMetadata({ params }: { params: Params }) {
  const p = await find(params);
  return p ? pageMetadata({ title: p.title, description: p.description, path: p.url }) : {};
}

export default async function CategoryPage({ params }: { params: Params }) {
  const p = await find(params);
  if (!p) notFound();
  return <ContentPage page={p} />;
}
