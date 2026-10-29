/**
 * Where a page's share image lives: a real .png file, /og/<page path>.png (/og/home.png for the home page), so every
 * static host serves it as image/png. Drawn at build by app/og/[...slug]/route.tsx; checked by scripts/check-out.mjs.
 */
export const ogImagePath = (pagePath: string): string => `/og/${pagePath === '/' ? 'home' : pagePath.replace(/^\/|\/$/g, '')}.png`;

/** Trim to whole words so a long description never runs off the card. */
export const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max)).replace(/[,;:.]$/, '')}…`);
