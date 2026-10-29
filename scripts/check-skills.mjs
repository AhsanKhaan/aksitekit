// Verifies the vendored skills (docs/SKILLS.md): every agent reads only reviewed, pinned skill files, byte for byte.
//
//   node scripts/check-skills.mjs              (npm run check:skills; CI and `npm run verify` run it)
//   node scripts/check-skills.mjs --print <skill>   print the on-disk sha256 list to paste into skills.lock.json
//                                                   after a reviewed pin update
//
// Fails when:
//   - a vendored skill's source isn't approved or approved-with-limits, or its commit is less than 7 days older than
//     its review (the same cooling-off rule as npm packages);
//   - a vendored file is missing, changed (sha256), extra, a symlink, or contains hidden Unicode (zero-width, bidi
//     controls, tag characters) that could hide instructions from a reviewer;
//   - a skill folder has no licence file, or vendor/skills holds a folder the lock doesn't list;
//   - a vendored skill has no audit (the skills.sh scanners: Gen Agent Trust Hub, Socket, Snyk) or its verdict breaks
//     the rule: 3/3 pass, or 2/3 where the only finding is Snyk's W011 (reads web pages); anything else is an
//     exception or not-listed entry with a written note;
//   - a vendored skill has no discovery record, or one dated from 2026-10-27 on that didn't come through Skillselion;
//   - an agent names a vendor/skills/<skill> path that isn't locked, or the agents that name a skill differ from its
//     usedBy in the lock;
//   - an agent mentions an excluded source other than on a line that says it's excluded.
//
// SKILLS_ROOT=<dir> checks another copy of the repo (tests).
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.env.SKILLS_ROOT || '.';
const errors = [];
const fail = (msg) => errors.push(msg);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;
const USABLE = new Set(['approved', 'approved-with-limits']);
const COOLING_DAYS = 7;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SKILLSELION_FROM = '2026-10-27'; // skills found from this day on must come through Skillselion (docs/SKILLS.md)

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) out.push({ path: p, link: true });
    else if (st.isDirectory()) out.push(...walk(p));
    else out.push({ path: p });
  }
  return out;
}

let lock;
try {
  lock = JSON.parse(readFileSync(join(ROOT, 'skills.lock.json'), 'utf8'));
} catch (e) {
  console.error(`check-skills: skills.lock.json doesn't parse: ${e.message}`);
  process.exit(1);
}
const vendorDir = lock.vendorDir;
if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(vendorDir || '') || vendorDir.split('/').includes('..')) {
  console.error('check-skills: skills.lock.json vendorDir must be a relative folder inside the repo');
  process.exit(1);
}

const skills = new Map(); // name → { source, entry }
for (const source of lock.sources) {
  for (const [name, entry] of Object.entries(source.vendored ?? {})) {
    if (skills.has(name)) fail(`${name}: vendored by two sources (${skills.get(name).source.repo}, ${source.repo})`);
    skills.set(name, { source, entry });
  }
}

if (process.argv[2] === '--print') {
  const dir = join(ROOT, vendorDir, process.argv[3] ?? '');
  if (!process.argv[3] || !existsSync(dir)) {
    console.error(`check-skills: usage: --print <skill folder in ${vendorDir}>`);
    process.exit(1);
  }
  const files = Object.fromEntries(walk(dir).map((f) => [relative(dir, f.path).split(sep).join('/'), sha256(readFileSync(f.path))])
    .sort(([a], [b]) => a.localeCompare(b)));
  console.log(JSON.stringify(files, null, 2));
  process.exit(0);
}

// Sources: status, pin, cooling-off.
for (const source of new Set([...skills.values()].map((s) => s.source))) {
  const where = `skills.lock.json ${source.repo}`;
  if (!USABLE.has(source.status)) fail(`${where}: status "${source.status}" can't have vendored skills`);
  if (!/^[0-9a-f]{40}$/.test(source.commit ?? '')) fail(`${where}: commit must be a full 40-character SHA`);
  const age = (Date.parse(source.reviewed) - Date.parse(source.commitDate)) / 86_400_000;
  if (!(age >= COOLING_DAYS)) fail(`${where}: commit ${source.commitDate} is less than ${COOLING_DAYS} days older than its review (${source.reviewed})`);
}

// Audit and discovery: the security score and how the skill was found.
function checkAudit(name, a) {
  if (!a) return fail(`${name}: no audit in skills.lock.json (record the skills.sh scanners, docs/SKILLS.md)`);
  if (!DATE.test(a.checked ?? '')) fail(`${name}: audit.checked must be a YYYY-MM-DD date`);
  const scanners = [a.trustHub, a.socket, a.snyk];
  const findings = a.findings ?? [];
  if (a.verdict === 'pass') {
    if (!scanners.every((s) => s === 'pass')) fail(`${name}: audit verdict "pass" needs all three scanners at pass`);
  } else if (a.verdict === 'pass-w011') {
    const ok = a.trustHub === 'pass' && a.socket === 'pass' && a.snyk === 'warn' && findings.length === 1 && findings[0] === 'W011';
    if (!ok) fail(`${name}: audit verdict "pass-w011" allows only Snyk's W011 warning; anything else is an exception`);
  } else if (a.verdict === 'exception' || a.verdict === 'not-listed') {
    if (!String(a.note ?? '').trim()) fail(`${name}: audit verdict "${a.verdict}" needs a note saying why it's kept`);
  } else {
    fail(`${name}: audit verdict must be pass, pass-w011, exception or not-listed (found "${a.verdict}")`);
  }
}
function checkDiscovery(name, d) {
  if (!d?.via || !DATE.test(d.date ?? '')) return fail(`${name}: no discovery record (via and date) in skills.lock.json`);
  if (d.date >= SKILLSELION_FROM && d.via !== 'skillselion') fail(`${name}: found on ${d.date}, so it must come through Skillselion (discovery.via "skillselion")`);
  if (d.via === 'skillselion' && !String(d.query ?? '').trim()) fail(`${name}: discovery through Skillselion needs the query`);
}
for (const [name, { entry }] of skills) {
  checkAudit(name, entry.audit);
  checkDiscovery(name, entry.discovery);
}

// Files: exact set, hashes, no symlinks, no hidden Unicode, a licence in every folder.
const vendorPath = join(ROOT, vendorDir);
const onDisk = existsSync(vendorPath) ? readdirSync(vendorPath).filter((n) => lstatSync(join(vendorPath, n)).isDirectory()) : [];
for (const name of onDisk) if (!skills.has(name)) fail(`${vendorDir}/${name}: not in skills.lock.json (review it first, docs/SKILLS.md)`);
let fileCount = 0;
for (const [name, { entry }] of skills) {
  const dir = join(vendorPath, name);
  if (!existsSync(dir)) {
    fail(`${vendorDir}/${name}: missing (skills.lock.json lists it)`);
    continue;
  }
  const expected = entry.files ?? {};
  const seen = new Set();
  for (const f of walk(dir)) {
    const rel = relative(dir, f.path).split(sep).join('/');
    seen.add(rel);
    if (f.link) {
      fail(`${vendorDir}/${name}/${rel}: symlink (vendored files must be plain files)`);
      continue;
    }
    if (!(rel in expected)) {
      fail(`${vendorDir}/${name}/${rel}: not in skills.lock.json`);
      continue;
    }
    const buf = readFileSync(f.path);
    fileCount += 1;
    if (sha256(buf) !== expected[rel]) fail(`${vendorDir}/${name}/${rel}: changed (sha256 differs from skills.lock.json)`);
    const lines = buf.toString('utf8').split('\n');
    const bad = lines.findIndex((l) => HIDDEN.test(l));
    if (bad >= 0) fail(`${vendorDir}/${name}/${rel}:${bad + 1}: hidden Unicode character`);
  }
  for (const rel of Object.keys(expected)) if (!seen.has(rel)) fail(`${vendorDir}/${name}/${rel}: missing (skills.lock.json lists it)`);
  if (!Object.keys(expected).some((rel) => /^(?:LICEN[CS]E|COPYING|NOTICE)/i.test(rel))) fail(`${vendorDir}/${name}: no licence file`);
}

// Agents: every vendored path they name is locked, and usedBy matches.
const agentsDir = join(ROOT, '.claude', 'agents');
const agents = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')) : [];
const named = new Map([...skills.keys()].map((k) => [k, new Set()]));
const ref = new RegExp(`${vendorDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([A-Za-z0-9._-]+)`, 'g');
const excluded = lock.sources.filter((s) => s.status === 'excluded').map((s) => s.repo);
for (const file of agents) {
  const agent = file.replace(/\.md$/, '');
  const text = readFileSync(join(agentsDir, file), 'utf8');
  for (const m of text.matchAll(ref)) {
    if (!skills.has(m[1])) fail(`.claude/agents/${file}: names ${vendorDir}/${m[1]}, which isn't a locked vendored skill`);
    else named.get(m[1]).add(agent);
  }
  text.split('\n').forEach((line, i) => {
    for (const repo of excluded) {
      if (line.includes(repo) && !/excluded/i.test(line)) fail(`.claude/agents/${file}:${i + 1}: names ${repo}, an excluded source`);
    }
  });
}
for (const [name, { entry }] of skills) {
  const want = [...(entry.usedBy ?? [])].sort().join(', ');
  const got = [...named.get(name)].sort().join(', ');
  if (want !== got) fail(`${name}: skills.lock.json usedBy is [${want}] but the agents that name ${vendorDir}/${name} are [${got}]`);
}

if (errors.length) {
  for (const e of errors) console.error(`check-skills: ${e}`);
  console.error(`check-skills: FAIL (${errors.length} problem${errors.length === 1 ? '' : 's'}). See docs/SKILLS.md.`);
  process.exit(1);
}
const sources = new Set([...skills.values()].map((s) => s.source.repo)).size;
console.log(`check-skills: OK (${skills.size} skills, ${fileCount} files, ${sources} sources, ${agents.length} agents)`);
