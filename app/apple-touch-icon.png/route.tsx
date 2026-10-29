import { iconImage } from '@/lib/seo/icon';

// The home-screen icon for iPhone and iPad: /apple-touch-icon.png (180 × 180), the path iOS also tries by default.
export const dynamic = 'force-static';

export function GET() {
  return iconImage(180);
}
