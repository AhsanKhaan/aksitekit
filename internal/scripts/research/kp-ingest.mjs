#!/usr/bin/env node
// research:ingest: internal/research/inputs/kp/* (Keyword Planner exports, one per competitor) → internal/research/out/keywords.json.
// Usage: node internal/scripts/research/kp-ingest.mjs [--root <dir>]   (or set FACTORY_ROOT; default: the working directory)
import { paths, resolveRoot, runCli, warn, writeJson } from './lib/common.mjs';
import { ingest } from './lib/pipeline.mjs';

const NAME = 'kp-ingest';

await runCli(NAME, async (argv) => {
  const root = resolveRoot(argv);
  const { data, warnings } = await ingest(root);
  for (const w of warnings) warn(NAME, w);
  await writeJson(paths(root).keywords, data);
  const ranged = data.keywords.filter((k) => k.volume.label === 'R').length;
  console.log(`${NAME}: ${data.files.length} export(s) → ${data.keywords.length} unique keywords ` +
    `(${ranged} with a bucketed volume [R]) → internal/research/out/keywords.json`);
});
