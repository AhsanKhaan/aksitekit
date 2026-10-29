// The vulnerability gate (`npm run audit`, docs/TODO-step-c.md §3): `npm audit` over every installed dependency, dev
// included. Any high or critical advisory fails unless audit-exceptions.json lists it with a reason, the owner's
// review date and an expiry date that hasn't passed. Moderate and low advisories are printed, not failed.
//
//   node scripts/audit.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isMain } from './lib/site.mjs';

const EXCEPTIONS = process.env.AUDIT_EXCEPTIONS || 'audit-exceptions.json';
const BLOCKING = new Set(['high', 'critical']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with the exceptions file itself: every entry needs an id, a package, a reason and dates. */
export function exceptionProblems(list, today) {
  const problems = [];
  for (const [i, a] of (list ?? []).entries()) {
    const where = `audit-exceptions.json → advisories[${i}]${a?.id ? ` (${a.id})` : ''}`;
    if (!/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/.test(String(a?.id ?? ''))) problems.push(`${where}: "id" must be a GHSA id`);
    if (!String(a?.package ?? '').trim()) problems.push(`${where}: "package" is empty`);
    if (String(a?.reason ?? '').trim().length < 20) problems.push(`${where}: "reason" must say why the risk is accepted (20+ characters)`);
    if (!DATE.test(String(a?.reviewed ?? ''))) problems.push(`${where}: "reviewed" must be the owner's review date (YYYY-MM-DD)`);
    if (!DATE.test(String(a?.expires ?? ''))) problems.push(`${where}: "expires" must be a date (YYYY-MM-DD)`);
    else if (a.expires < today) problems.push(`${where}: expired on ${a.expires}; re-check the advisory and fix it or renew the exception`);
  }
  return problems;
}

/** Blocking findings and notes from an `npm audit --json` report. */
export function evaluate(report, accepted, today) {
  const failures = [];
  const notes = [];
  if (!report || typeof report !== 'object' || (!report.vulnerabilities && !report.metadata)) {
    failures.push(`npm audit gave no report${report?.error ? `: ${report.error.summary ?? report.error.code}` : ''}`);
    return { failures, notes };
  }
  for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
    const advisories = (v.via ?? []).filter((x) => typeof x === 'object');
    if (!BLOCKING.has(v.severity)) {
      if (advisories.length) notes.push(`${name}: ${v.severity} (${advisories.map((a) => a.url?.split('/').pop()).join(', ')})`);
      continue;
    }
    // A package that is vulnerable only through another one is reported with that package as its advisory source.
    for (const via of advisories.filter((a) => BLOCKING.has(a.severity))) {
      const id = String(via.url ?? '').split('/').pop();
      const a = (accepted ?? []).find((x) => x.id === id && x.package === name);
      if (!a) failures.push(`${name}: ${via.title} (${id}, ${via.severity}) is neither fixed nor in audit-exceptions.json`);
      else if (a.expires < today) failures.push(`${name}: the exception for ${id} expired on ${a.expires}`);
      else notes.push(`${name}: ${id} accepted until ${a.expires} (${String(a.reason).slice(0, 80)})`);
    }
  }
  return { failures, notes };
}

if (isMain(import.meta.url)) {
  const today = new Date().toISOString().slice(0, 10);
  const file = existsSync(EXCEPTIONS) ? JSON.parse(readFileSync(EXCEPTIONS, 'utf8')) : { advisories: [] };
  // One fixed command string: Windows needs a shell to find npm.cmd, and Node deprecates passing args alongside one.
  const r = spawnSync('npm audit --json', { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(r.stdout || '{}');
  } catch {
    report = { error: { summary: (r.stderr || r.stdout || '').slice(0, 200) } };
  }
  const problems = exceptionProblems(file.advisories, today);
  const { failures, notes } = evaluate(report, file.advisories, today);
  for (const n of notes) console.log(`audit: note: ${n}`);
  const all = [...problems, ...failures];
  if (all.length) {
    console.error(`audit: FAIL, ${all.length} problem(s)\n - ${all.join('\n - ')}`);
    process.exitCode = 1;
  } else {
    const m = report.metadata?.vulnerabilities ?? {};
    console.log(`audit: OK (no unaccepted high or critical advisories; ${m.moderate ?? 0} moderate, ${m.low ?? 0} low [M: npm audit])`);
  }
}
