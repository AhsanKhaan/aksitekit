#!/usr/bin/env node
// Deterministic gate runner for the pipeline in AGENTS.md. No dependencies.
//
//   node .claude/skills/gate/gate.mjs <stage> [--url <https-url>] [--dry-run]   check a stage and record the result
//   node .claude/skills/gate/gate.mjs status                                   latest result per stage, and the next one
//   node .claude/skills/gate/gate.mjs list                                     the stage table
//   node .claude/skills/gate/gate.mjs record <stage> <PASS|FAIL|BLOCKED|SKIPPED> "<evidence>"
//
// Exit codes: 0 PASS or SKIPPED, 1 FAIL, 2 usage error, 3 BLOCKED (a script, file, tool or owner input is missing).
// `record` writes PASS only for manual stages (preprod, go), whose evidence is the owner's confirmation.
import { spawnSync } from 'node:child_process';
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

const abs = (p) => path.join(ROOT, ...p.split('/'));
const readJson = (p) => JSON.parse(readFileSync(abs(p), 'utf8'));

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
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
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
    if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(out) || out.split('/').includes('..')) {
      fail('factory.config.json → build.outputDir must be a relative folder inside the repo (for example "out" or "dist")');
    }
    if (!String(b.commands?.build || '').trim()) fail(`factory.config.json → build.commands.build is empty for "${framework}"`, 'architect: set the build command');
    const seed = [...list].sort((a, b) => a.dr - b.dr || a.domain.localeCompare(b.domain))[0];
    return `domain ${domain}; ${list.length} competitor(s); seed ${seed.domain} (DR ${seed.dr} [M: owner]); technology ${framework} → ${out}/`;
  },

  'recon-no-copy'() {
    const notes = [];
    for (const c of competitors()) {
      const p = `research/out/recon/${c.domain}.md`;
      const text = readFileSync(abs(p), 'utf8');
      if (!/https?:\/\//.test(text)) fail(`${p} lists no source URLs (record every public page visited)`);
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/^\s*>/.test(line) && line.replace(/^\s*>\s*/, '').split(/\s+/).filter(Boolean).length > 15) {
          fail(`${p}:${i + 1} quotes more than 15 words (blockquote). Describe structure; don't copy text`);
        }
        for (const m of line.matchAll(/["“]([^"”]+)["”]/g)) {
          if (m[1].split(/\s+/).filter(Boolean).length > 15) fail(`${p}:${i + 1} quotes more than 15 words. Describe structure; don't copy text`);
        }
      });
      notes.push(c.domain);
    }
    return `recon for ${notes.length} competitor(s), no long quotes`;
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
    const topKeys = fm[1].split('\n').filter((l) => /^[A-Za-z]/.test(l)).map((l) => l.split(':')[0]);
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

  'no-template-placeholders'(stage) {
    for (const o of expandOutputs(stage).filter((f) => !f.endsWith('/') && /\.(md|json)$/.test(f))) {
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
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
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
  const needsModules = /(^|[\s&;])(next|eslint|tsc|vitest|playwright)(\s|$)/.test(cmd);
  if (needsModules && !existsSync(abs('node_modules'))) missing.push('node_modules (run npm ci)');
  return [...new Set(missing)];
}

function ownerOf(missing) {
  if (missing.every((m) => m.startsWith('scripts/research/') || m.startsWith('tests/research/'))) return 'Step B (keyword pipeline)';
  if (missing.some((m) => m.startsWith('npm script'))) return 'Phase E (package.json)';
  if (missing.every((m) => m.startsWith('node_modules'))) return 'the owner (npm ci)';
  return `Step C (${TODO_C})`;
}

const SAFE_URL = /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~/%-]*)?$/;

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
    if (stage.manual) blocked(`manual stage: ${stage.manual}`, `record it: gate.mjs record ${stage.id} PASS "<evidence>"`);
    const before = STAGES.slice(0, STAGES.indexOf(stage)).filter((s) => applies(s) && !['PASS', 'SKIPPED'].includes(latest()[s.id]?.result));
    if (before.length) process.stdout.write(`warning: earlier stage(s) not passed yet: ${before.map((s) => s.id).join(', ')}\n`);
    for (const need of stage.needs || []) {
      const ok = need.endsWith('/') ? filesIn(need).some((f) => /\.(csv|tsv)$/i.test(f)) : existsSync(abs(need));
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
    process.stdout.write(`${s.id.padEnd(13)} ${s.agent.padEnd(20)} ${state}\n`);
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
    for (const s of STAGES) process.stdout.write(`${s.id.padEnd(13)} ${s.agent.padEnd(20)} ${[...(s.checks || []).map((c) => `check:${c}`), ...(s.npm || []).map((n) => `npm:${n}`)].join(' ') || (s.manual ? 'manual' : 'outputs')}\n`);
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
