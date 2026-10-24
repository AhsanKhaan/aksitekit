// ZAP gate (docs/BLUEPRINT.md, security table: "any medium or high alert not in the reviewed exceptions file").
// ZAP's own exit code isn't used, because it also fails on Low and Informational warnings. This script decides:
//   - fail on any Medium or High alert whose rule isn't an IGNORE line in the rules file;
//   - fail on any alert, whatever its risk, whose rule is a FAIL line;
//   - fail when an IGNORE line has no reason and review date, or was reviewed more than a year ago;
//   - alerts ZAP marks as false positives (confidence 0) never count.
//
//   node .github/scripts/zap-gate.mjs report_json.json .github/zap/rules.tsv
//
// The rules file is ZAP's own config format (zap-baseline.py -c): tab-separated `<id>\t<LEVEL>\t(<name>)[\t<note>]`,
// `#` comments. An exception's note must say why it's safe and when it was reviewed: `...; reviewed YYYY-MM-DD`.
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RISK = ['Informational', 'Low', 'Medium', 'High'];
const MAX_REVIEW_AGE_DAYS = 365;
// Report text comes from scanned pages (URLs, payloads): one line, no "::" workflow commands, no table breaks.
const clean = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/::/g, ': :').replace(/\|/g, '/').slice(0, 300);

/** Parse rules.tsv into { levels: Map<id, {level, name, note, line}>, problems: string[] }. */
export function parseRules(text) {
  const levels = new Map();
  const problems = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const cols = line.split('\t');
    if (cols.length < 3 || cols.length > 4) {
      problems.push(`rules line ${i + 1}: expected 3 or 4 tab-separated columns, got ${cols.length}`);
      return;
    }
    const [id, level, name, note = ''] = cols.map((c) => c.trim());
    if (!/^\d+$/.test(id)) problems.push(`rules line ${i + 1}: rule id must be a number (got "${id}")`);
    else if (!['IGNORE', 'INFO', 'WARN', 'FAIL'].includes(level)) problems.push(`rules line ${i + 1}: unsupported level "${level}"`);
    else levels.set(id, { level, name, note, line: i + 1 });
  });
  return { levels, problems };
}

/** Problems with the exceptions themselves: each IGNORE needs a reason and a review date under a year old. */
export function exceptionProblems(levels, today) {
  const problems = [];
  for (const [id, r] of levels) {
    if (r.level !== 'IGNORE') continue;
    const date = r.note.match(/reviewed (\d{4}-\d{2}-\d{2})/)?.[1];
    if (!date || r.note.replace(/reviewed \d{4}-\d{2}-\d{2}/, '').replace(/[;,.\s]/g, '').length < 10) {
      problems.push(`rule ${id} (line ${r.line}): an exception needs a fourth column saying why it's safe, ending "reviewed YYYY-MM-DD"`);
      continue;
    }
    const age = (Date.parse(today) - Date.parse(date)) / 86_400_000;
    if (Number.isNaN(age) || age < -1) problems.push(`rule ${id} (line ${r.line}): review date ${date} is invalid or in the future`);
    else if (age > MAX_REVIEW_AGE_DAYS) problems.push(`rule ${id} (line ${r.line}): reviewed ${date}, over ${MAX_REVIEW_AGE_DAYS} days ago; review it again`);
  }
  return problems;
}

/** Evaluate a ZAP JSON report against the rules. Returns { failures, excepted, problems }. */
export function evaluate(report, rulesText, today) {
  const { levels, problems } = parseRules(rulesText);
  problems.push(...exceptionProblems(levels, today));
  if (!report || !Array.isArray(report.site)) problems.push('report has no "site" list: not a ZAP JSON report');
  const failures = [];
  const excepted = [];
  for (const site of report?.site ?? []) {
    for (const a of site.alerts ?? []) {
      const id = String(a.pluginid ?? '');
      const risk = Number(a.riskcode ?? 0);
      if (String(a.confidence) === '0') continue; // marked false positive in ZAP
      const rule = levels.get(id);
      const entry = {
        id,
        risk: RISK[risk] ?? String(risk),
        name: clean(a.name ?? a.alert),
        count: Number(a.count ?? a.instances?.length ?? 1),
        example: clean(a.instances?.[0]?.uri ?? site['@name']),
      };
      if (rule?.level === 'FAIL') failures.push({ ...entry, why: 'rule set to FAIL in the rules file' });
      else if (risk >= 2 && rule?.level === 'IGNORE') excepted.push({ ...entry, why: clean(rule.note) });
      else if (risk >= 2) failures.push({ ...entry, why: `${entry.risk} risk, not a reviewed exception` });
    }
  }
  return { failures, excepted, problems };
}

function summary(result) {
  const rows = (list) => list.map((f) => `| ${f.id} | ${f.risk} | ${f.name} | ${f.count} | ${f.why} |`).join('\n');
  const parts = [`## ZAP gate: ${result.failures.length || result.problems.length ? 'failed' : 'passed'}`];
  if (result.problems.length) parts.push(result.problems.map((p) => `- ${p}`).join('\n'));
  if (result.failures.length) parts.push(`| Rule | Risk | Alert | Count | Why it fails |\n|---|---|---|---|---|\n${rows(result.failures)}`);
  if (result.excepted.length) parts.push(`Reviewed exceptions:\n\n| Rule | Risk | Alert | Count | Exception |\n|---|---|---|---|---|\n${rows(result.excepted)}`);
  return `${parts.join('\n\n')}\n`;
}

const runDirectly = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (runDirectly) {
  const [reportFile, rulesFile] = process.argv.slice(2);
  if (!reportFile || !rulesFile) {
    console.error('usage: node .github/scripts/zap-gate.mjs <report_json.json> <rules.tsv>');
    process.exit(2);
  }
  if (!existsSync(reportFile)) {
    console.log(`::error::${reportFile} not found: the ZAP scan didn't produce a report`);
    process.exit(1);
  }
  const today = process.env.ZAP_GATE_TODAY ?? new Date().toISOString().slice(0, 10);
  const result = evaluate(JSON.parse(readFileSync(reportFile, 'utf8')), readFileSync(rulesFile, 'utf8'), today);
  for (const p of result.problems) console.log(`  FAIL  ${p}`);
  for (const f of result.failures) console.log(`  FAIL  [${f.risk}] ${f.id} ${f.name} x${f.count} (${f.why}), e.g. ${f.example}`);
  for (const e of result.excepted) console.log(`  ok    [${e.risk}] ${e.id} ${e.name} x${e.count}: reviewed exception (${e.why})`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(result));
  const failed = result.failures.length + result.problems.length;
  console.log(failed ? `zap-gate: ${failed} problem(s)` : 'zap-gate: no Medium or High alerts outside the reviewed exceptions');
  process.exit(failed ? 1 : 0);
}
