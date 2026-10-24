// The three pipeline stages as functions: each reads its inputs under `root` and returns what the CLI writes.
// Nothing here writes files, so a failed stage leaves the previous outputs alone.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { RuleViolation, cmp, keywordKey, loadResearchConfig, parseWith, paths, readJson } from './common.mjs';
import { mergeRows, parseKpExport } from './kp.mjs';
import { readCategories, readCompetitors, readKd } from './inputs.mjs';
import { REJECT_REASONS, byVolume, kdTodoRows, selectKeywords } from './select.mjs';
import { buildMap, checkMap } from './cluster.mjs';
import { keywordMapSchema, keywordsFileSchema, selectedFileSchema } from './schemas.mjs';

const ACCEPTED = new Set(['.csv', '.tsv', '.txt']);
const NO_EXPORTS = 'drop one Keyword Planner export per competitor there (see research/inputs/README.md)';

/** research:ingest. @returns {{ data: object, warnings: string[] }} data = keywords.json */
export async function ingest(root) {
  const p = paths(root);
  const config = await loadResearchConfig(root);
  if (!existsSync(p.kpDir)) throw new RuleViolation(`research/inputs/kp/ does not exist; ${NO_EXPORTS}`);
  const names = (await readdir(p.kpDir, { withFileTypes: true }))
    .filter((d) => d.isFile() && !d.name.startsWith('.') && d.name.toLowerCase() !== 'readme.md')
    .map((d) => d.name)
    .sort(cmp);
  if (names.length === 0) throw new RuleViolation(`research/inputs/kp/ has no exports; ${NO_EXPORTS}`);

  const errors = [];
  const files = [];
  const rows = [];
  for (const name of names) {
    const ext = extname(name).toLowerCase();
    if (!ACCEPTED.has(ext)) {
      errors.push(`kp/${name}: only .csv, .tsv or .txt files are read; download Keyword Planner's ".csv" ` +
        '(or save the sheet as "CSV UTF-8")');
      continue;
    }
    try {
      const parsed = parseKpExport(await readFile(join(p.kpDir, name)), { file: `kp/${name}`, source: name.slice(0, -ext.length) });
      files.push(parsed.meta);
      rows.push(...parsed.rows);
    } catch (err) {
      if (!(err instanceof RuleViolation)) throw err;
      errors.push(...err.messages);
    }
  }
  if (errors.length) throw new RuleViolation(errors);

  const keywords = mergeRows(rows);
  const kd = await readKd(p.kd, { defaultSource: config.kdSource });
  for (const k of keywords) {
    const hit = kd.get(keywordKey(k.keyword));
    if (hit) {
      k.kd = hit.kd;
      k.kdSource = hit.source;
    }
  }
  const warnings = [];
  const windows = [...new Set(files.map((f) => f.months.join('..')))].sort(cmp);
  if (windows.length > 1) {
    warnings.push(`the exports cover different 12-month windows (${windows.join(', ')}); for a keyword found in several ` +
      'files, the newest window wins');
  }
  return { data: { files, keywords }, warnings };
}

/** research:select. @returns {{ data: object, kdTodo: string[][], warnings: string[] }} data = selected.json */
export async function select(root) {
  const p = paths(root);
  const config = await loadResearchConfig(root);
  const input = parseWith(keywordsFileSchema,
    await readJson(p.keywords, 'research/out/keywords.json', 'run `npm run research:ingest` first'),
    'research/out/keywords.json');
  const competitors = await readCompetitors(p.competitors);
  const kd = await readKd(p.kd, { defaultSource: config.kdSource });
  const result = selectKeywords(input.keywords, { config, kd, competitors });

  const warnings = [];
  const domains = new Set(competitors.map((c) => c.domain));
  const sources = [...new Set(input.files.map((f) => f.source))].sort(cmp);
  for (const s of sources) {
    if (!domains.has(s)) warnings.push(`kp/${s}.*: "${s}" is not a domain in competitors.csv (name each export after its competitor's domain)`);
  }
  const ranked = competitors.filter((c) => c.dr !== null).sort((a, b) => (a.dr - b.dr) || cmp(a.domain, b.domain));
  if (ranked.length && !sources.includes(ranked[0].domain)) {
    warnings.push(`the lowest-DR competitor (${ranked[0].domain}, DR ${ranked[0].dr}) has no export in kp/; it is the seed`);
  }
  if (competitors.length === 0) warnings.push('competitors.csv lists no competitors, so no brand keywords can be filtered');
  const known = new Set(input.keywords.map((k) => keywordKey(k.keyword)));
  const unused = [...kd.values()].filter((e) => !known.has(keywordKey(e.keyword)));
  if (unused.length) warnings.push(`kd.csv has ${unused.length} keyword(s) that are in no export (ignored)`);

  const byReason = Object.fromEntries(REJECT_REASONS.map((r) => [r, result.rejected.filter((x) => x.reason === r).length]));
  const data = {
    thresholds: { minVolume: config.minVolume, maxKd: config.maxKd, maxSeasonality: config.maxSeasonality },
    counts: {
      input: input.keywords.length,
      selected: result.selected.length,
      pendingKd: result.pending.length,
      rejected: result.rejected.length,
      byReason,
    },
    brands: result.brands.map((b) => ({ domain: b.domain, term: b.tokens.join(' ') })),
    selected: result.selected.sort(byVolume),
    pending: result.pending.sort(byVolume),
    rejected: result.rejected.sort((a, b) => cmp(a.reason, b.reason) || byVolume(a, b)),
  };
  const accounted = data.selected.length + data.pending.length + data.rejected.length;
  if (accounted !== input.keywords.length) {
    throw new RuleViolation(`internal: ${input.keywords.length} keywords in, ${accounted} accounted for`);
  }
  return { data, kdTodo: kdTodoRows(result.pending), warnings };
}

async function readSelected(p) {
  return parseWith(selectedFileSchema,
    await readJson(p.selected, 'research/out/selected.json', 'run `npm run research:select` first'),
    'research/out/selected.json');
}

/** research:cluster. @returns {{ data: object, warnings: string[] }} data = keyword-map.json */
export async function cluster(root) {
  const p = paths(root);
  const config = await loadResearchConfig(root);
  const input = await readSelected(p);
  const categories = await readCategories(p.categories);
  const cap = config.maxSecondaryKeywordsPerPage;
  const map = buildMap(input.selected, { cap, categories });
  const data = { pendingKd: input.pending.length, pages: map.pages, discarded: map.discarded };
  const violations = checkMap(data, { cap, selected: input.selected });
  if (violations.length) throw new RuleViolation(violations);
  const warnings = [...map.warnings];
  if (input.pending.length) {
    warnings.push(`${input.pending.length} keyword(s) still need a KD value (research/out/kd-todo.csv); they are not in this map yet`);
  }
  if (input.selected.length === 0) warnings.push('no keyword is selected yet, so the map has no pages');
  return { data, warnings };
}

/** `cluster.mjs --check`: validates an existing keyword-map.json (for example after a hand edit) against the rules. */
export async function checkExisting(root) {
  const p = paths(root);
  const config = await loadResearchConfig(root);
  const input = await readSelected(p);
  const map = parseWith(keywordMapSchema,
    await readJson(p.keywordMap, 'research/out/keyword-map.json', 'run `npm run research:cluster` first'),
    'research/out/keyword-map.json');
  const violations = checkMap(map, { cap: config.maxSecondaryKeywordsPerPage, selected: input.selected });
  if (violations.length) throw new RuleViolation(violations);
  return map;
}
