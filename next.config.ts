import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

// Static export (docs/TODO-step-c.md §1): build.outputDir "out", trailing slashes, no server code. Headers live in
// _headers (scripts/gen-public-files.mjs): a static export ignores next.config headers().
export default function config(phase: string): NextConfig {
  return {
    // `next build` is always the static export. `next dev` runs without it: in export mode the dev server throws
    // "missing param in generateStaticParams()" for an unknown address instead of showing the 404 page; the routes'
    // `dynamicParams = false` gives dev the same 404.
    output: phase === PHASE_DEVELOPMENT_SERVER ? undefined : 'export',
    trailingSlash: true,
    images: { unoptimized: true },
    reactStrictMode: true,
    poweredByHeader: false,
    // The project folder is the root even inside a git worktree (.claude/worktrees/<name>), where a parent folder has
    // its own lockfile.
    turbopack: { root: process.cwd() },
    outputFileTracingRoot: process.cwd(),
    compiler: {
      // console.* stays out of production bundles, except console.error.
      removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
    },
    experimental: {
      // CSS inside each page's HTML instead of a render-blocking file: a first visit paints one round trip sooner.
      // The CSP allows inline styles.
      inlineCss: true,
    },
  };
}
