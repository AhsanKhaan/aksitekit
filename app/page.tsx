import ContentPage from '@/components/ContentPage';
import { registry } from '@/lib/registry';
import { pageMetadata } from '@/lib/seo/metadata';

export function generateMetadata() {
  const home = registry().home;
  return pageMetadata({ title: home.title, description: home.description, path: '/' });
}

export default function Home() {
  return <ContentPage page={registry().home} />;
}
