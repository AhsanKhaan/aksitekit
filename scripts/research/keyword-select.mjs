#!/usr/bin/env node
// research:select: research/out/keywords.json + factory.config.json → research + inputs/kd.csv + inputs/competitors.csv
//   → research/out/selected.json and research/out/kd-todo.csv (keywords that still need a KD value).
// Usage: node scripts/research/keyword-select.mjs [--root <dir>] [--strict]
//   --strict also fails while kd-todo.csv is not empty (the "keywords done" gate).
import { paths, resolveRoot, runCli, toCsv, warn, writeJson, writeText } from './lib/common.mjs';
import { select } from './lib/pipeline.mjs';

const NAME = 'keyword-select';

await runCli(NAME, async (argv) => {
  const root = resolveRoot(argv);
  const { data, kdTodo, warnings } = await select(root);
  for (const w of warnings) warn(NAME, w);
  const p = paths(root);
  await writeJson(p.selected, data);
  await writeText(p.kdTodo, toCsv(kdTodo));
  const reasons = Object.entries(data.counts.byReason).filter(([, n]) => n).map(([r, n]) => `${r} ${n}`).join(', ');
  console.log(`${NAME}: ${data.counts.input} keywords → ${data.counts.selected} selected, ` +
    `${data.counts.pendingKd} waiting for KD, ${data.counts.rejected} rejected${reasons ? ` (${reasons})` : ''} ` +
    '→ research/out/selected.json');
  if (data.counts.pendingKd) {
    console.log(`${NAME}: fill in kd for the ${data.counts.pendingKd} keyword(s) in research/out/kd-todo.csv, add those rows ` +
      'to research/inputs/kd.csv, then run it again');
    if (argv.includes('--strict')) {
      console.error(`${NAME}: FAILED (--strict): ${data.counts.pendingKd} keyword(s) still have no KD; outputs were written`);
      process.exitCode = 1;
    }
  }
});
