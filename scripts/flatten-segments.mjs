// Next.js starter only (factory.config.json → build.commands.build runs it after `next build`). Next.js 16 static
// export writes segment-prefetch payloads as nested folders (about/__next.about/__PAGE__.txt), but the client asks
// for a flat, dot-joined name (about/__next.about.__PAGE__.txt). Static hosts serve files literally, so every prefetch
// would 404 and log a console error. This copies each nested file to the flat name.
// Re-check after each Next.js upgrade, and drop the step once the export writes the flat files itself.
//
//   node scripts/flatten-segments.mjs
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { isMain, outputDir, readConfig } from './lib/site.mjs';

const filesUnder = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? filesUnder(join(dir, n)) : [join(dir, n)]));

/** Copies nested segment files to their flat names under `out`; returns how many were copied. */
export function flatten(out) {
  let copied = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (!statSync(p).isDirectory()) continue;
      if (!name.startsWith('__next.')) {
        walk(p);
        continue;
      }
      for (const file of filesUnder(p)) {
        const target = join(dirname(p), `${name}.${relative(p, file).split(sep).join('.')}`);
        if (!existsSync(target)) {
          copyFileSync(file, target);
          copied++;
        }
      }
    }
  };
  walk(out);
  return copied;
}

if (isMain(import.meta.url)) {
  const out = outputDir(readConfig());
  if (!existsSync(out)) {
    console.error(`flatten-segments: ${out}/ not found`);
    process.exit(1);
  }
  console.log(`flatten-segments: ${flatten(out)} prefetch file(s) copied to flat names in ${out}/`);
}
