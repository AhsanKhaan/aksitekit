#!/usr/bin/env node
// Deterministic gate runner for the pipeline in AGENTS.md. No dependencies.
//
//   node .claude/skills/gate/gate.mjs <stage> [--url <https-url>] [--dry-run]   check a stage and record the result
//   node .claude/skills/gate/gate.mjs status                                   latest result per stage, and the next one
//   node .claude/skills/gate/gate.mjs list                                     the stage table
//   node .claude/skills/gate/gate.mjs record <stage> <PASS|FAIL|BLOCKED|SKIPPED> "<evidence>"
//
// Exit codes: 0 PASS or SKIPPED, 1 FAIL, 2 usage error, 3 BLOCKED (a script, file, tool or owner input is missing).
// `record` writes PASS only for manual stages (idea-approval, design-approval, preprod, go), whose evidence is the
// owner's confirmation. An approval stage pins its file by content hash: the owner types APPROVE <hash>.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from '../../hooks/secret-patterns.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const LEDGER = path.join(ROOT, 'reports', 'ledger.md');
const STAGES = JSON.parse(readFileSync(path.join(HERE, 'stages.json'), 'utf8')).stages;
const RESULTS = ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED'];
const PLACEHOLDER = /\{\{[A-Z0-9_]+\}\}/;
const TODO_C = 'docs/TODO-step-c.md';

const IDEA_INPUT = 'research/inputs/idea.md';

const abs = (p) => path.join(ROOT, ...p.split('/'));
const readJson = (p) => JSON.parse(readFileSync(abs(p), 'utf8'));
const readText = (p) => readFileSync(abs(p), 'utf8').replace(/\r\n/g, '\n');
// What the owner approves: the first 12 hex of the file's sha256, line endings normalised so a checkout can't change it.
const fileHash = (p) => createHash('sha256').update(readText(p)).digest('hex').slice(0, 12);

class Outcome extends Error {
  constructor(result, evidence, next) {
    super(evidence);
    this.result = result;
    this.evidence = evidence;
    this.next = next;
  }
}
const fail = (evidence, next = 'fix and re-run the gate') => { throw new Outcome('FAIL', evidence, next); };
const blocked = (evidence, next) => { throw new Outcome('BLOCKED', evidence, next); };

// ---------- inputs ----------

function parseCsv(text) {
  const rows = [];
  for (const line of text.replace(/^\ufeff/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map((s) => s.trim()));
  }
  return rows;
}

function normalizeDomain(d) {
  return String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/;

function competitors() {
  const p = 'research/inputs/competitors.csv';
  if (!existsSync(abs(p))) fail(`${p} is missing`, 'run intake (/start)');
  const rows = parseCsv(readFileSync(abs(p), 'utf8'));
  const header = (rows.shift() || []).map((h) => h.toLowerCase());
  // `brands` is optional (research/inputs/README.md): the keyword pipeline's brand filter reads it.
  if (!['domain,dr,notes', 'domain,dr,notes,brands'].includes(header.join(','))) {
    fail(`${p} header must be "domain,dr,notes" or "domain,dr,notes,brands", found "${header.join(',')}"`);
  }
  return rows.map((r) => ({ domain: normalizeDomain(r[0]), dr: r[1] === '' ? NaN : Number(r[1]), notes: r[2] || '' }));
}

function config() {
  try {
    return readJson('factory.config.json');
  } catch (e) {
    fail(`factory.config.json doesn't parse: ${e.message}`);
  }
}

// A markdown file's "## " sections, in order; the text before the first one has the heading ''.
function sections(text) {
  const out = [{ heading: '', body: '' }];
  for (const line of text.split('\n')) {
    const m = line.match(/^## (.+)$/);
    if (m) out.push({ heading: m[1].trim(), body: '' });
    else out[out.length - 1].body += `${line}\n`;
  }
  return out;
}

// The owner's idea, in their own words, from intake.
function ownerIdea() {
  if (!existsSync(abs(IDEA_INPUT))) fail(`${IDEA_INPUT} is missing`, 'owner: describe the idea in their own words (/start intake)');
  const own = sections(readText(IDEA_INPUT)).find((s) => /in the owner'?s words/i.test(s.heading));
  const words = own ? own.body.replace(/<!--[\s\S]*?-->/g, '').trim() : '';
  if (!words) fail(`${IDEA_INPUT} → "## In the owner's words" is empty`, 'owner: describe the idea in their own words (/start intake)');
  return words;
}

// More than 15 words in a blockquote or between quotation marks: someone's text copied rather than described.
function longQuote(line) {
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  if (/^\s*>/.test(line) && words(line.replace(/^\s*>\s*/, '')) > 15) return 'blockquote';
  return [...line.matchAll(/["“]([^"”]+)["”]/g)].some((m) => words(m[1]) > 15) ? 'quote' : null;
}

// Each approval stage against the file it pins: the latest ledger row must be a PASS whose APPROVE <hash> matches the
// file now. Returns the problems as { evidence, next }; an empty list means every approval is current.
function staleApprovals() {
  const by = latest();
  const problems = [];
  for (const s of STAGES.filter((x) => x.approves)) {
    if (!existsSync(abs(s.approves))) {
      problems.push({ evidence: `${s.approves} doesn't exist yet`, next: `run the stage that writes it, then ${s.id}` });
      continue;
    }
    const now = fileHash(s.approves);
    const row = by[s.id];
    const approved = row?.result === 'PASS' ? row.evidence.match(/\bAPPROVE ([0-9a-f]{12})\b/i)?.[1].toLowerCase() : undefined;
    const how = `owner: read ${s.approves} and type APPROVE ${now}; then gate.mjs record ${s.id} PASS "owner typed: APPROVE ${now}"`;
    if (!approved) problems.push({ evidence: `the owner hasn't approved ${s.approves} (now ${now})`, next: how });
    else if (approved !== now) problems.push({ evidence: `${s.approves} changed since the owner approved it (${approved} → ${now})`, next: how });
  }
  return problems;
}

// ---------- outputs ----------

function expandOutputs(stage) {
  const out = [];
  for (const o of stage.outputs || []) {
    if (o.includes('{competitor}')) for (const c of competitors()) out.push(o.replace('{competitor}', c.domain));
    else out.push(o);
  }
  return out;
}

function filesIn(dir) {
  const d = abs(dir);
  if (!existsSync(d) || !statSync(d).isDirectory()) return [];
  return readdirSync(d).filter((f) => !f.startsWith('.') && statSync(path.join(d, f)).isFile());
}

function checkOutputs(stage) {
  const missing = [];
  for (const o of expandOutputs(stage)) {
    if (o.endsWith('/')) {
      if (filesIn(o).length === 0) missing.push(`${o} (no files)`);
    } else if (!existsSync(abs(o)) || statSync(abs(o)).size === 0) missing.push(o);
  }
  if (missing.length) fail(`missing or empty: ${missing.join(', ')}`, `${stage.agent} writes them`);
}

// ---------- built-in checks ----------

const CHECKS = {
  intake() {
    const cfg = config();
    const domain = normalizeDomain(cfg?.project?.domain);
    if (!DOMAIN.test(domain)) fail('factory.config.json → project.domain is empty or not a domain', 'owner: give the domain');
    const list = competitors();
    if (list.length === 0) fail('research/inputs/competitors.csv has no competitors', 'owner: list competitors and their DR');
    const seen = new Set();
    for (const c of list) {
      if (!DOMAIN.test(c.domain)) fail(`competitor "${c.domain}" is not a domain`);
      if (seen.has(c.domain)) fail(`competitor ${c.domain} is listed twice`);
      if (c.domain === domain) fail('the project\'s own domain is listed as a competitor');
      if (!Number.isFinite(c.dr) || c.dr < 0 || c.dr > 100) fail(`competitor ${c.domain} needs a DR from 0 to 100 (owner supplies it)`, 'owner: give the DR');
      seen.add(c.domain);
    }
    const cfgList = (cfg.competitors || []).map((c) => normalizeDomain(typeof c === 'string' ? c : c.domain)).sort();
    if (cfgList.length && cfgList.join() !== [...seen].sort().join()) {
      fail('factory.config.json → competitors differs from research/inputs/competitors.csv');
    }
    const b = cfg.build || {};
    const framework = String(b.framework || '').trim();
    if (!framework) fail('factory.config.json → build.framework is empty', 'owner: choose Next.js (built-in starter) or another technology');
    const out = String(b.outputDir || '');
    if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(out) || out.split('/').includes('..')) {
      fail('factory.config.json → build.outputDir must be a relative folder inside the repo (for example "out" or "dist")');
    }
    if (!String(b.commands?.build || '').trim()) fail(`factory.config.json → build.commands.build is empty for "${framework}"`, 'architect: set the build command');
    const idea = ownerIdea().split(/\s+/).length;
    const seed = [...list].sort((a, b) => a.dr - b.dr || a.domain.localeCompare(b.domain))[0];
    return `domain ${domain}; ${list.length} competitor(s); seed ${seed.domain} (DR ${seed.dr} [M: owner]); technology ${framework} → ${out}/; idea ${idea} words [M]`;
  },

  'recon-no-copy'() {
    const notes = [];
    for (const c of competitors()) {
      const p = `research/out/recon/${c.domain}.md`;
      const text = readFileSync(abs(p), 'utf8');
      if (!/https?:\/\//.test(text)) fail(`${p} lists no source URLs (record every public page visited)`);
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        const q = longQuote(line);
        if (q) fail(`${p}:${i + 1} quotes more than 15 words${q === 'blockquote' ? ' (blockquote)' : ''}. Describe structure; don't copy text`);
      });
      notes.push(c.domain);
    }
    return `recon for ${notes.length} competitor(s), no long quotes`;
  },

  'recon-idea'() {
    for (const c of competitors()) {
      const p = `research/out/recon/${c.domain}.md`;
      const part = sections(readText(p)).find((s) => /against the owner'?s idea/i.test(s.heading));
      if (!part || !part.body.trim()) {
        fail(`${p} has no "## Against the owner's idea" section (how this competitor serves each thing the owner wants visitors to do)`, 'competitor-recon adds it');
      }
    }
    return "every recon file measures its competitor against the owner's idea";
  },

  'idea-brief'() {
    const p = 'docs/IDEA.md';
    const text = readText(p);
    const parts = sections(text);
    const part = (re, name) => parts.find((s) => re.test(s.heading)) ?? fail(`${p} has no "## ${name}" section`, 'idea-groomer writes it from docs/templates/IDEA.md');
    const own = part(/owner'?s idea/i, "1. The owner's idea");
    const jobs = part(/\bjobs\b/i, '2. Visitors and their jobs');
    const cover = part(/coverage/i, '3. Coverage by competitor');
    part(/where we can win/i, '4. Where we can win');
    const feats = part(/^(?:\d+\.\s*)?features\b/i, '5. Features');
    part(/wave[\s-]*1/i, '6. Wave 1');
    part(/positioning/i, '7. Positioning');
    part(/out of scope/i, '8. Out of scope');
    const open = part(/open questions/i, '9. Open questions for the owner');

    const flat = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ').trim();
    if (!flat(own.body).includes(flat(ownerIdea()))) fail(`${p} → §1 must quote ${IDEA_INPUT} → "In the owner's words" unchanged`);

    const jobIds = [...new Set([...jobs.body.matchAll(/\bJ\d+\b/g)].map((m) => m[0]))];
    if (!jobIds.length) fail(`${p} → §2 names no jobs (J1, J2, …)`);
    const unmatched = competitors().map((c) => c.domain).filter((d) => !cover.body.toLowerCase().includes(d));
    if (unmatched.length) fail(`${p} → §3 doesn't cover ${unmatched.join(', ')}: match the idea against every recon file`);
    const uncovered = jobIds.filter((j) => !new RegExp(`\\b${j}\\b`).test(cover.body));
    if (uncovered.length) fail(`${p} → §3 doesn't say how competitors serve ${uncovered.join(', ')}`);

    const lines = feats.body.split('\n').filter((l) => l.trim().startsWith('|'));
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
    const head = lines.length ? cells(lines[0]).map((h) => h.toLowerCase()) : [];
    const col = Object.fromEntries(['feature', 'job', 'priority', 'evidence'].map((k) => [k, head.findIndex((h) => h.startsWith(k))]));
    if (Object.values(col).includes(-1)) fail(`${p} → §5 needs a table with Feature, Job, Priority and Evidence columns`);
    const rows = lines.slice(1).filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim())).map(cells);
    if (!rows.length) fail(`${p} → §5 lists no features`);
    const served = new Set();
    for (const r of rows) {
      const name = r[col.feature] || '(unnamed)';
      const priority = String(r[col.priority] || '').toLowerCase().replace('’', "'");
      if (!['must', 'should', 'could', "won't"].includes(priority)) fail(`${p} → §5 "${name}": priority must be must, should, could or won't`);
      if (['', '-', '—', 'n/a', 'none'].includes(String(r[col.evidence] || '').toLowerCase())) fail(`${p} → §5 "${name}" has no evidence (a recon file and section, or the owner's idea)`);
      const ids = String(r[col.job] || '').match(/\bJ\d+\b/g) || [];
      const unknown = ids.filter((j) => !jobIds.includes(j));
      if (!ids.length || unknown.length) fail(`${p} → §5 "${name}" must name a job from §2${unknown.length ? ` (${unknown.join(', ')} isn't one)` : ''}`);
      for (const j of ids) served.add(j);
    }
    const must = rows.filter((r) => r[col.priority].toLowerCase() === 'must').length;
    if (!must) fail(`${p} → §5 has no "must" feature, so wave 1 has nothing to build`);
    const orphans = jobIds.filter((j) => !served.has(j));
    if (orphans.length) fail(`${p} → §5 has no feature for ${orphans.join(', ')}: give each job one, or a "won't" row with the reason`);

    let owners = false;
    text.split('\n').forEach((line, i) => {
      const h = line.match(/^## (.+)$/);
      if (h) owners = /owner/i.test(h[1]); // the owner's own words may be quoted in full
      else if (!owners && longQuote(line)) fail(`${p}:${i + 1} quotes more than 15 words. Describe what recon found; don't copy text`);
    });

    const asks = open.body.split('\n').filter((l) => /^\s*[-*] \[ \]/.test(l)).length;
    if (asks) blocked(`${p} → §9 has ${asks} unanswered question(s) for the owner`, `owner: answer them; the orchestrator writes the answers in ${IDEA_INPUT} → "Owner answers" and idea-groomer re-runs`);
    const hash = fileHash(p);
    return `${jobIds.length} job(s), ${rows.length} feature(s) (${must} must), ${competitors().length} competitor(s) matched [M]; content ${hash}: the owner approves it with APPROVE ${hash}`;
  },

  'approvals-current'() {
    const problems = staleApprovals();
    if (problems.length) blocked(problems.map((x) => x.evidence).join('; '), problems[0].next);
    return `owner approvals match ${STAGES.filter((s) => s.approves).map((s) => s.approves).join(' and ')}`;
  },

  'json-outputs'(stage) {
    for (const o of expandOutputs(stage).filter((f) => f.endsWith('.json'))) {
      try {
        readJson(o);
      } catch (e) {
        fail(`${o} doesn't parse: ${e.message}`);
      }
    }
    const map = readJson('research/out/keyword-map.json');
    const rows = Array.isArray(map) ? map : map.pages || [];
    return `keyword map: ${rows.length} URL(s)`;
  },

  'content-plan'() {
    const plan = readJson('research/out/content-plan.json');
    const map = readJson('research/out/keyword-map.json');
    const rows = Array.isArray(map) ? map : map.pages || [];
    const urls = new Set(rows.map((r) => r.url));
    const wave1 = (plan.waves || []).find((w) => w.wave === 1);
    if (!wave1 || !Array.isArray(wave1.urls) || wave1.urls.length === 0) fail('content-plan.json has no wave 1 URLs');
    for (const u of wave1.urls) {
      if (!urls.has(u)) fail(`wave-1 URL ${u} is not in keyword-map.json`);
      const brief = `research/out/briefs/${briefSlug(u)}.md`;
      if (!existsSync(abs(brief))) fail(`no brief for ${u} (expected ${brief})`);
    }
    const types = [...new Set(rows.map((r) => r.type).filter(Boolean))];
    const missing = types.filter((t) => !Array.isArray(plan.schema?.[t]) || plan.schema[t].length === 0);
    if (missing.length) fail(`content-plan.json → schema has no JSON-LD plan for page type(s): ${missing.join(', ')}`);
    return `wave 1: ${wave1.urls.length} URL(s), all briefed; JSON-LD plan for ${types.length} page type(s)`;
  },

  'growth-plan'() {
    const plan = readJson('growth/plan.json');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.start || '')) fail('growth/plan.json → start must be a YYYY-MM-DD date');
    const days = plan.days || [];
    if (days.length !== 90) fail(`growth/plan.json has ${days.length} days; it needs exactly 90`);
    const statuses = new Set(['todo', 'doing', 'done', 'skipped']);
    days.forEach((d, i) => {
      const where = `day ${i + 1}`;
      if (d.day !== i + 1) fail(`${where}: "day" must be ${i + 1} (one task per day, in order)`);
      if (d.week !== Math.ceil(d.day / 7)) fail(`${where}: "week" must be ${Math.ceil(d.day / 7)}`);
      if (!Number.isInteger(d.minutes) || d.minutes < 1 || d.minutes > 45) fail(`${where}: minutes must be 1–45 (found ${d.minutes})`);
      for (const k of ['theme', 'task', 'doneWhen']) if (!String(d[k] || '').trim()) fail(`${where}: "${k}" is empty`);
      if (!statuses.has(d.status)) fail(`${where}: status must be todo, doing, done or skipped`);
    });
    const open = days.filter((d) => d.status === 'doing').length;
    if (open > 3) fail(`${open} tasks are "doing"; the limit is 3 open items`);
    return `90 days, ${days.reduce((s, d) => s + d.minutes, 0)} minutes in total [M], ${open} open`;
  },

  hosting() {
    const h = config().hosting || {};
    if (!(h.options || []).includes(h.target)) fail(`hosting.target "${h.target}" is not one of ${JSON.stringify(h.options)}`);
    if (h.freePlanOnly !== true) fail('hosting.freePlanOnly must stay true');
    return `hosting ${h.target}`;
  },

  'design-md'() {
    // Structure only (google-labs-code/design.md spec, alpha). The official linter and the contrast gate are npm scripts.
    const text = readFileSync(abs('docs/DESIGN.md'), 'utf8').replace(/\r\n/g, '\n');
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fm) fail('docs/DESIGN.md must start with YAML front matter between --- lines');
    for (const key of ['name', 'colors', 'typography']) {
      if (!new RegExp(`^${key}:`, 'm').test(fm[1])) fail(`docs/DESIGN.md front matter has no "${key}:"`);
    }
    const topKeys = fm[1].split('\n').filter((l) => /^[A-Z]/i.test(l)).map((l) => l.split(':')[0]);
    const dupKey = topKeys.find((k, i) => topKeys.indexOf(k) !== i);
    if (dupKey) fail(`docs/DESIGN.md front matter repeats the key "${dupKey}"`);
    const order = ['overview|brand & style', 'colors', 'typography', 'layout|layout & spacing', 'elevation & depth|elevation', 'shapes', 'components', "do's and don'ts"];
    const headings = [...text.slice(fm[0].length).matchAll(/^## (.+)$/gm)].map((m) => m[1].trim().toLowerCase());
    const dupHead = headings.find((h, i) => headings.indexOf(h) !== i);
    if (dupHead) fail(`docs/DESIGN.md repeats the section "## ${dupHead}"`);
    let last = -1;
    for (const h of headings) {
      const idx = order.findIndex((o) => o.split('|').includes(h));
      if (idx === -1) continue;
      if (idx < last) fail(`docs/DESIGN.md section "## ${h}" is out of the spec order`);
      last = idx;
    }
    return 'DESIGN.md structure follows the spec';
  },

  'code-review-verdict'() {
    const p = 'reports/code-review.md';
    const text = readFileSync(abs(p), 'utf8');
    const verdict = text.match(/^Verdict: (PASS|CHANGES REQUESTED)\s*$/m);
    if (!verdict) fail(`${p} has no "Verdict: PASS" or "Verdict: CHANGES REQUESTED" line`, 'code-reviewer writes it');
    const blockers = text.match(/^Blockers: (\d+)\s*$/m);
    if (!blockers) fail(`${p} has no "Blockers: <n>" line`, 'code-reviewer writes it');
    const reviewed = text.match(/^Reviewed: ([0-9a-f]{7,40})\s*$/m);
    if (!reviewed) fail(`${p} has no "Reviewed: <commit SHA>" line`, 'code-reviewer writes it');
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    const head = git.status === 0 ? git.stdout.trim() : '';
    if (!head) blocked('git rev-parse HEAD failed, so the review can\'t be matched to a commit', 'run the gate inside the git checkout');
    if (!head.startsWith(reviewed[1])) fail(`${p} reviewed ${reviewed[1].slice(0, 12)}, but HEAD is ${head.slice(0, 12)}: the review is stale`, 'code-reviewer re-reviews HEAD');
    if (verdict[1] !== 'PASS' || Number(blockers[1]) > 0) {
      fail(`code review: ${verdict[1]}, ${blockers[1]} blocker(s) open`, 'coder fixes them, then code-reviewer re-reviews');
    }
    return `code review PASS at ${head.slice(0, 12)}, 0 blockers`;
  },

  'ai-search-files'() {
    const cfg = config();
    const out = String(cfg.build?.outputDir || 'out');
    if (!existsSync(abs(out))) blocked(`${out}/ doesn't exist yet`, `build the site first (Step C, ${TODO_C})`);
    const robotsPath = `${out}/robots.txt`;
    const llmsPath = `${out}/llms.txt`;
    for (const p of [robotsPath, llmsPath]) {
      if (!existsSync(abs(p)) || statSync(abs(p)).size === 0) fail(`${p} is missing or empty`, `gen-public-files.mjs writes it (Step C, ${TODO_C})`);
    }
    const first = readFileSync(abs(llmsPath), 'utf8').split(/\r?\n/).find((l) => l.trim());
    if (!/^# \S/.test(first || '')) fail(`${llmsPath} must start with "# <site name>" (the llms.txt format)`);
    const groups = robotsGroups(readFileSync(abs(robotsPath), 'utf8'));
    const bots = cfg.bots || {};
    const problems = [];
    if (bots.aiSearch === 'allow') {
      for (const ua of AI_SEARCH_BOTS) if (blocksSite(groups, ua)) problems.push(`${ua} is blocked but bots.aiSearch is "allow"`);
    }
    if (bots.aiTraining === 'block') {
      for (const ua of AI_TRAINING_BOTS) if (!blocksSite(groups, ua)) problems.push(`${ua} isn't blocked but bots.aiTraining is "block"`);
    }
    if (problems.length) fail(`${robotsPath}: ${problems.join('; ')}`, 'gen-public-files.mjs must follow factory.config.json → bots');
    return `llms.txt starts with "${first.trim().slice(0, 60)}"; robots.txt follows bots (aiSearch ${bots.aiSearch}, aiTraining ${bots.aiTraining})`;
  },

  'google-sources'(stage) {
    // Google's current docs are the source of truth (docs/SEO-GATE.md §5). The stage's report lists the Google pages its
    // agent read, each with the date it read them; a required page that's missing, or read too long ago, fails.
    let cfg;
    try {
      cfg = readJson('seo-checks.json').googleSources;
    } catch (e) {
      fail(`seo-checks.json is missing or doesn't parse: ${e.message}`);
    }
    const required = Array.isArray(cfg?.required) ? cfg.required : [];
    const maxAge = cfg?.maxAgeDays;
    if (!required.length || !required.every((r) => normUrl(r?.url)) || !Number.isInteger(maxAge) || maxAge < 1) {
      fail('seo-checks.json → googleSources needs a "required" list of { page, url } and a whole-number "maxAgeDays"');
    }
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    let oldest = '';
    const files = expandOutputs(stage).filter((f) => f.endsWith('.md'));
    if (!files.length) fail(`stage "${stage.id}" has no .md output for the google-sources check to read`, 'list the report in stages.json → outputs');
    for (const p of files) {
      const listed = new Set();
      for (const row of googleSourceRows(p)) {
        const where = `${p}:${row.line}`;
        for (const url of row.urls) {
          let host = '';
          try {
            const u = new URL(url);
            host = u.protocol === 'https:' ? u.hostname.toLowerCase() : '';
          } catch { /* reported below */ }
          if (!/(?:^|\.)google\.com$/.test(host)) fail(`${where} lists ${url}, which isn't an https Google page`);
        }
        if (!row.date) fail(`${where} has no YYYY-MM-DD date for ${row.url}`, 'read the page again and write the date you read it');
        const t = Date.parse(`${row.date}T00:00:00Z`);
        if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== row.date) fail(`${where}: ${row.date} is not a real date`);
        const age = Math.round((today - t) / 86400000);
        if (age < -1) fail(`${where}: ${row.date} is in the future`);
        if (age > maxAge) fail(`${where}: ${row.url} was checked ${row.date}, ${age} days ago (limit ${maxAge})`, 'read the page again, update the rules if Google changed it, and write today\'s date');
        if (!oldest || row.date < oldest) oldest = row.date;
        for (const url of row.urls) listed.add(normUrl(url));
      }
      const missing = required.filter((r) => !listed.has(normUrl(r.url)));
      if (missing.length) {
        fail(`${p} doesn't list ${missing.map((r) => `"${r.page}" (${r.url})`).join(', ')} under "Google sources checked"`, 'read each page and add it with the date checked');
      }
    }
    return `Google sources: ${required.length} required page(s) listed in ${files.join(', ')}, all checked within ${maxAge} days (oldest ${oldest})`;
  },

  'no-template-placeholders'(stage) {
    for (const o of expandOutputs(stage).filter((f) => !f.endsWith('/') && /\.(?:md|json)$/.test(f))) {
      const lines = readFileSync(abs(o), 'utf8').split(/\r?\n/);
      const i = lines.findIndex((l) => PLACEHOLDER.test(l));
      if (i !== -1) fail(`${o}:${i + 1} still has a template placeholder (${lines[i].match(PLACEHOLDER)[0]})`);
    }
    return 'no template placeholders left';
  },
};

// robots.txt as groups: { agents: [lowercase user-agent], rules: [{ allow, path }] }.
const AI_SEARCH_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot'];
const AI_TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot'];

function robotsGroups(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Z-]+)\s*:\s*((?:\S.*)?)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(m[2].trim().toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ allow: key === 'allow', path: m[2].trim() });
    }
  }
  return groups;
}

// The group a crawler obeys is the one that names it, else the "*" group. It's shut out when that group disallows "/"
// and allows nothing back.
function blocksSite(groups, ua) {
  const name = ua.toLowerCase();
  const group = groups.find((g) => g.agents.includes(name)) || groups.find((g) => g.agents.includes('*'));
  if (!group) return false;
  return group.rules.some((r) => !r.allow && r.path === '/') && !group.rules.some((r) => r.allow && r.path.startsWith('/'));
}

// The table under a "## Google sources checked" heading (any level 2–4, optionally numbered), up to the next heading:
// one row per Google page, with its URL and the YYYY-MM-DD date it was read. Every URL in a row is returned, so a second
// link that isn't Google's can't slip through.
const GOOGLE_SECTION = /^#{2,4}\s+(?:\d+(?:\.\d+)*\.?\s+)?Google sources checked\s*$/i;

function googleSourceRows(p) {
  const lines = readFileSync(abs(p), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => GOOGLE_SECTION.test(l.trim()));
  if (start === -1) {
    fail(`${p} has no "## Google sources checked" section (docs/SEO-GATE.md §5)`, 'read the Google pages in seo-checks.json → googleSources and list each with the date checked');
  }
  const rows = [];
  for (let i = start + 1; i < lines.length && !/^#{1,6}\s/.test(lines[i]); i++) {
    const urls = [...lines[i].matchAll(/https?:\/\/[^\s|)>\]`]+/g)].map((m) => m[0]);
    if (!/^\s*\|/.test(lines[i]) || !urls.length) continue;
    rows.push({ line: i + 1, url: urls[0], urls, date: lines[i].match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] });
  }
  return rows;
}

// Compares Google URLs by host and path: no query, fragment or trailing slash.
function normUrl(u) {
  try {
    const x = new URL(String(u));
    return `${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

function briefSlug(url) {
  const s = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/+|\/+$/g, '');
  return s ? s.replace(/\//g, '--') : 'home';
}

// ---------- npm gates ----------

const TOOL_CONFIG = {
  next: 'next.config.ts',
  eslint: 'eslint.config.mjs',
  tsc: 'tsconfig.json',
  vitest: 'vitest.config.ts',
  playwright: 'playwright.config.ts',
  '@lhci/cli': 'lighthouserc.json',
};

function missingFor(script, scripts, seen = new Set()) {
  if (seen.has(script)) return [];
  seen.add(script);
  const cmd = scripts[script];
  if (cmd === undefined) return [`npm script "${script}" (not in package.json; Phase E adds it)`];
  const missing = [];
  for (const m of cmd.matchAll(/(?:^|\s)((?:scripts|tests|lib|app)\/[\w./-]+\.(?:mjs|cjs|js|ts))(?=\s|$)/g)) {
    if (!existsSync(abs(m[1]))) missing.push(m[1]);
  }
  for (const m of cmd.matchAll(/\bnpm run ([\w:-]+)/g)) missing.push(...missingFor(m[1], scripts, seen));
  for (const [tool, cfg] of Object.entries(TOOL_CONFIG)) {
    if (new RegExp(`(^|[\\s&;])(npx[^&;]*)?${tool.replace(/[/@]/g, '\\$&')}(@[\\d.]+)?(\\s|$)`).test(cmd) && !existsSync(abs(cfg))) missing.push(cfg);
  }
  const needsModules = /(?:^|[\s&;])(?:next|eslint|tsc|vitest|playwright|designmd)(?:\s|$)/.test(cmd);
  if (needsModules && !existsSync(abs('node_modules'))) missing.push('node_modules (run npm ci)');
  return [...new Set(missing)];
}

function ownerOf(missing) {
  if (missing.every((m) => m.startsWith('scripts/research/') || m.startsWith('tests/research/'))) return 'Step B (keyword pipeline)';
  if (missing.some((m) => m.startsWith('npm script'))) return 'Phase E (package.json)';
  if (missing.every((m) => m.startsWith('node_modules'))) return 'the owner (npm ci)';
  return `Step C (${TODO_C})`;
}

const SAFE_URL = /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[\w.~/%-]*)?$/;

function runNpm(stage, opts) {
  const pkg = readJson('package.json');
  const lines = [];
  if ((stage.urlArg || []).length) {
    if (!opts.url) blocked(`this stage needs --url <the project's own preview or production URL>`, 're-run with --url');
    if (!SAFE_URL.test(opts.url)) fail(`--url "${opts.url}" is not a plain http(s) URL`);
  }
  for (const script of stage.npm || []) {
    const missing = missingFor(script, pkg.scripts || {});
    if (missing.length) blocked(`npm run ${script} can't run yet; missing: ${missing.join(', ')}`, `needs ${ownerOf(missing)}`);
    const args = ['run', script];
    if ((stage.urlArg || []).includes(script)) args.push('--', opts.url);
    process.stdout.write(`\n> npm ${args.join(' ')}\n`);
    const r = spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 256 * 1024 * 1024 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    process.stdout.write(out);
    // eslint-disable-next-line no-control-regex -- \x1b starts the terminal colour codes this strips from the ledger line
    const tail = redact(out.replace(/\x1b\[[0-9;]*m/g, '')).trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' / ');
    if (r.status !== 0) fail(`npm run ${script} exited ${r.status ?? r.signal}: ${tail}`.slice(0, 400));
    lines.push(`npm run ${script} ok${tail ? ` (${tail.slice(0, 120)})` : ''}`);
  }
  return lines;
}

// ---------- ledger ----------

const HEADER = '# Pipeline ledger\n\nAppend-only; written by `.claude/skills/gate/gate.mjs`. Format: AGENTS.md §5.\n\n' +
  '| When (UTC) | Stage | Agent | Attempt | Result | Gate | Evidence | Next |\n|---|---|---|---|---|---|---|---|\n';

function readLedger() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, 'utf8').split(/\r?\n/)
    .filter((l) => /^\| \d{4}-/.test(l))
    .map((l) => {
      const c = l.slice(1, -1).split(/(?<!\\)\|/).map((s) => s.trim());
      return { when: c[0], stage: c[1], agent: c[2], attempt: Number(c[3]), result: c[4], gate: c[5], evidence: c[6], next: c[7] };
    });
}

function appendLedger(stage, result, gate, evidence, next) {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  if (!existsSync(LEDGER)) writeFileSync(LEDGER, HEADER);
  const attempt = readLedger().filter((r) => r.stage === stage.id).length + 1;
  const cell = (s) => redact(String(s)).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  const when = new Date().toISOString().slice(0, 16) + 'Z';
  appendFileSync(LEDGER, `| ${when} | ${stage.id} | ${stage.agent} | ${attempt} | ${result} | ${cell(gate)} | ${cell(evidence)} | ${cell(next)} |\n`);
  return attempt;
}

function applies(stage) {
  if (stage.when !== 'cloudflare') return true;
  try {
    return String(readJson('factory.config.json').hosting?.target || '').startsWith('cloudflare');
  } catch {
    return true;
  }
}

function latest() {
  const by = {};
  for (const r of readLedger()) by[r.stage] = r;
  return by;
}

function nextStage(by = latest()) {
  return STAGES.find((s) => applies(s) && !['PASS', 'SKIPPED'].includes(by[s.id]?.result));
}

// ---------- commands ----------

function runStage(stage, opts) {
  const gateCmd = `gate.mjs ${stage.id}${(stage.npm || []).length ? ` + npm run ${stage.npm.join(', ')}` : ''}`;
  let result = 'PASS';
  let evidence = [];
  let next;
  try {
    if (!applies(stage)) throw new Outcome('SKIPPED', 'hosting target is not Cloudflare', null);
    if (stage.approves && existsSync(abs(stage.approves))) {
      const h = fileHash(stage.approves);
      blocked(`manual stage: the owner reads ${stage.approves} (now ${h}) and types APPROVE ${h}, or says what to change`, `record it: gate.mjs record ${stage.id} PASS "owner typed: APPROVE ${h}"`);
    }
    if (stage.manual) blocked(`manual stage: ${stage.manual}`, `record it: gate.mjs record ${stage.id} PASS "<evidence>"`);
    const before = STAGES.slice(0, STAGES.indexOf(stage)).filter((s) => applies(s) && !['PASS', 'SKIPPED'].includes(latest()[s.id]?.result));
    if (before.length) process.stdout.write(`warning: earlier stage(s) not passed yet: ${before.map((s) => s.id).join(', ')}\n`);
    for (const need of stage.needs || []) {
      const ok = need.endsWith('/') ? filesIn(need).some((f) => /\.(?:csv|tsv)$/i.test(f)) : existsSync(abs(need));
      if (!ok) blocked(`${need} is empty`, need.includes('/kp/') ? 'owner: drop Keyword Planner CSVs (one per competitor) in research/inputs/kp/' : `owner: provide ${need}`);
    }
    const checkAll = () => {
      checkOutputs(stage);
      for (const name of stage.checks || []) evidence.push(CHECKS[name](stage));
    };
    // Most stages: the agent's files must exist before the npm gates judge them. When the npm scripts produce the
    // outputs (the keyword pipeline), they run first.
    if (!stage.npmProduces) checkAll();
    evidence.push(...runNpm(stage, opts));
    if (stage.npmProduces) checkAll();
    const nx = STAGES.slice(STAGES.indexOf(stage) + 1).find(applies);
    next = nx ? nx.id : 'done';
  } catch (e) {
    if (!(e instanceof Outcome)) throw e;
    result = e.result;
    evidence = [e.evidence];
    next = e.next ?? STAGES.slice(STAGES.indexOf(stage) + 1).find(applies)?.id ?? 'done';
  }
  const text = evidence.filter(Boolean).join('; ') || 'outputs present';
  const attempt = opts.dryRun ? '-' : appendLedger(stage, result, gateCmd, text, next);
  process.stdout.write(`\n${stage.id}: ${result} (attempt ${attempt})\n  ${text}\n  next: ${next}\n`);
  if (result === 'FAIL' && !opts.dryRun) {
    const rows = readLedger().filter((r) => r.stage === stage.id).slice(-3);
    if (rows.length === 3 && rows.every((r) => r.result === 'FAIL' && r.evidence === rows[0].evidence)) {
      process.stdout.write('  3 failed attempts with the same failure: stop and ask the owner.\n');
    }
  }
  return { PASS: 0, SKIPPED: 0, FAIL: 1, BLOCKED: 3 }[result];
}

function status() {
  const by = latest();
  for (const s of STAGES) {
    const r = by[s.id];
    const state = !applies(s) ? 'n/a (not Cloudflare)' : r ? `${r.result} (attempt ${r.attempt}, ${r.when})` : '-';
    process.stdout.write(`${s.id.padEnd(16)} ${s.agent.padEnd(20)} ${state}\n`);
  }
  const n = nextStage(by);
  process.stdout.write(`\nnext: ${n ? `${n.id} (${n.agent}): ${n.summary}` : 'all stages passed'}\n`);
  if (n && by[n.id]?.next) process.stdout.write(`last note: ${by[n.id].next}\n`);
  return 0;
}

function record(id, result, evidence) {
  const stage = STAGES.find((s) => s.id === id);
  if (!stage) return usage(`unknown stage "${id}"`);
  if (!RESULTS.includes(result)) return usage(`result must be one of ${RESULTS.join(', ')}`);
  if (!evidence || !evidence.trim()) return usage('evidence is required');
  if (result === 'PASS' && !stage.manual) return usage(`"${id}" is decided by its gate; run: gate.mjs ${id}`);
  if (result === 'PASS') {
    const by = latest();
    const open = STAGES.slice(0, STAGES.indexOf(stage)).filter((s) => applies(s) && !['PASS', 'SKIPPED'].includes(by[s.id]?.result));
    if (open.length) return usage(`"${id}" can't pass before these stages pass: ${open.map((s) => s.id).join(', ')}`);
  }
  if (id === 'go' && result === 'PASS' && !/\bGO [0-9a-f]{7,40}\b/i.test(evidence)) {
    return usage('the go stage needs the owner\'s words, e.g. "owner typed: GO 1a2b3c4"');
  }
  if (id === 'go' && result === 'PASS') {
    const stale = staleApprovals();
    if (stale.length) return usage(`no GO while an approval is out of date: ${stale.map((x) => x.evidence).join('; ')}`);
  }
  if (stage.approves && result === 'PASS') {
    if (!existsSync(abs(stage.approves))) return usage(`${stage.approves} doesn't exist yet`);
    const now = fileHash(stage.approves);
    const typed = evidence.match(/\bAPPROVE ([0-9a-f]{12})\b/i)?.[1].toLowerCase();
    if (!typed) return usage(`the ${id} stage needs the owner's words, e.g. "owner typed: APPROVE ${now}"`);
    if (typed !== now) return usage(`the owner approved ${typed}, but ${stage.approves} is ${now} now: show them the current file and ask again`);
  }
  const nx = STAGES.slice(STAGES.indexOf(stage) + 1).find(applies);
  const attempt = appendLedger(stage, result, `gate.mjs record ${id}`, evidence, result === 'PASS' ? nx?.id ?? 'done' : 'see evidence');
  process.stdout.write(`${id}: ${result} recorded (attempt ${attempt})\n`);
  return 0;
}

function usage(msg) {
  if (msg) process.stderr.write(`gate: ${msg}\n`);
  process.stderr.write('usage: gate.mjs <stage> [--url <url>] [--dry-run] | status | list | record <stage> <RESULT> "<evidence>"\n');
  return 2;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') return usage();
  if (cmd === 'status') return status();
  if (cmd === 'list') {
    for (const s of STAGES) process.stdout.write(`${s.id.padEnd(16)} ${s.agent.padEnd(20)} ${[...(s.checks || []).map((c) => `check:${c}`), ...(s.npm || []).map((n) => `npm:${n}`)].join(' ') || (s.manual ? 'manual' : 'outputs')}\n`);
    return 0;
  }
  if (cmd === 'record') return record(rest[0], rest[1], rest.slice(2).join(' '));
  const stage = STAGES.find((s) => s.id === cmd);
  if (!stage) return usage(`unknown stage "${cmd}"`);
  const opts = { dryRun: rest.includes('--dry-run') };
  const u = rest.indexOf('--url');
  if (u !== -1) opts.url = rest[u + 1];
  return runStage(stage, opts);
}

process.exitCode = main(process.argv.slice(2));
