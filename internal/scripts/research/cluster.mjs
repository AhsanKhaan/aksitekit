#!/usr/bin/env node
// research:cluster: internal/research/out/selected.json (+ optional inputs/categories.csv) → internal/research/out/keyword-map.json.
// Fails on any map rule: URL shape, one primary per URL (cannibalization), one owner per keyword, secondary cap.
// Usage: node internal/scripts/research/cluster.mjs [--root <dir>] [--check]
//   --check validates the existing keyword-map.json (for example after a hand edit) instead of rebuilding it.
import { paths, resolveRoot, runCli, warn, writeJson } from './lib/common.mjs';
import { checkExisting, cluster } from './lib/pipeline.mjs';

const NAME = 'cluster';

await runCli(NAME, async (argv) => {
  const root = resolveRoot(argv);
  if (argv.includes('--check')) {
    const map = await checkExisting(root);
    console.log(`${NAME}: internal/research/out/keyword-map.json passes (${map.pages.length} pages, ${map.discarded.length} discarded)`);
    return;
  }
  const { data, warnings } = await cluster(root);
  for (const w of warnings) warn(NAME, w);
  await writeJson(paths(root).keywordMap, data);
  const types = Object.entries(Object.groupBy(data.pages, (pg) => pg.type)).map(([t, list]) => `${list.length} ${t}`).sort();
  const uncategorized = data.pages.filter((pg) => pg.category === 'uncategorized').length;
  console.log(`${NAME}: ${data.pages.length} pages (${types.join(', ') || 'none'}), ${data.discarded.length} discarded ` +
    '→ internal/research/out/keyword-map.json');
  if (uncategorized) {
    console.log(`${NAME}: ${uncategorized} page(s) are in "uncategorized"; give their cluster head a category in ` +
      'internal/research/inputs/categories.csv');
  }
});
