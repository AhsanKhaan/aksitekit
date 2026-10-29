import { icoFromPng, iconImage } from '@/lib/seo/icon';

// /favicon.ico: browsers and crawlers ask for it whatever the pages link, so it must exist (check-out.mjs, check-live.mjs).
export const dynamic = 'force-static';

export async function GET() {
  const png = await iconImage(32).arrayBuffer();
  return new Response(icoFromPng(png, 32), { headers: { 'Content-Type': 'image/x-icon' } });
}
