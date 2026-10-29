// Repository checks that need no install (docs/TODO-step-c.md §3, `npm run check:repo`): no secrets in tracked
// files, no .env or .dev.vars file committed, no placeholder text in the site's content and code, and the
// supply-chain settings (exact versions, the lockfile, .npmrc, no lifecycle hooks). CI runs it before `npm ci`.
//
//   node scripts/check-repo.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { findSecrets, isSecretPath } from '../.claude/hooks/secret-patterns.mjs';
import { isMain } from './lib/site.mjs';

/** Where placeholder text would reach visitors: the site's content, code and public files. Docs may say "TODO". */
export const CONTENT_PATHS = /^(?:app|components|lib|content|public)\//;
export const PLACEHOLDERS = [
  { name: 'TODO', re: /\bTODO\b/ },
  { name: 'FIXME', re: /\bFIXME\b/ },
  { name: 'lorem ipsum', re: /\blorem\b/i },
  { name: 'coming soon', re: /\bcoming soon\b/i },
  { name: '[your …]', re: /\[your[ -][a-z]+\]/i },
  { name: 'template placeholder', re: /\{\{[A-Z0-9_]+\}\}/ },
];
const TEXT = /\.(?:[cm]?[jt]sx?|json|md|mdx|css|html|txt|xml|svg|ya?ml|toml|tsv|csv)$|^[^.]+$|\.(?:gitignore|gitattributes|npmrc|example)$/i;
const NPMRC_LINES = ['ignore-scripts=true', 'save-exact=true'];
const HOOKS = new Set(['prepare', 'preinstall', 'install', 'postinstall', 'prepublish', 'prepublishOnly', 'prepack', 'postpack']);

/**
 * Vendored skills are byte-for-byte copies whose every file is hashed (npm run check:skills), and gitleaks scans them
 * in CI with narrow, reviewed allowlists (.gitleaks.toml). Their docs quote fake keys to teach secret patterns, which
 * this broader line-by-line scan would report, so they are left to those two checks.
 */
export const VENDORED = /^vendor\/skills\//;

/** Problems in one tracked file. */
export function fileProblems(path, text) {
  const problems = [];
  if (isSecretPath(path)) problems.push(`${path}: a secrets file is committed (remove it from git and rotate what it held)`);
  // Planted gate fixtures carry the marker the edit hook honours (.claude/hooks/post-edit.mjs).
  if (text && !VENDORED.test(path) && !text.includes('secret-scan:allow')) for (const h of findSecrets(text)) problems.push(`${path}:${h.line}: looks like a ${h.rule}`);
  if (text && CONTENT_PATHS.test(path)) {
    text.split(/\r?\n/).forEach((line, i) => {
      for (const p of PLACEHOLDERS) if (p.re.test(line)) problems.push(`${path}:${i + 1}: placeholder text (${p.name})`);
    });
  }
  return problems;
}

/** Supply-chain settings (CLAUDE.md "Never"). */
export function supplyChainProblems({ pkg, npmrc, lockfile }) {
  const problems = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (!/^\d+\.\d+\.\d+$/.test(String(range))) problems.push(`package.json ${section}.${name} = "${range}" is not an exact version`);
    }
  }
  const lines = String(npmrc ?? '').split(/\r?\n/).map((l) => l.trim());
  for (const l of NPMRC_LINES) if (!lines.includes(l)) problems.push(`.npmrc must contain "${l}"`);
  if (!lines.some((l) => /^min-release-age=([7-9]|\d{2,})$/.test(l))) problems.push('.npmrc must set min-release-age to 7 days or more');
  if (!lockfile) problems.push('package-lock.json is missing');
  for (const name of Object.keys(pkg.scripts ?? {})) {
    if (HOOKS.has(name) || /^(?:pre|post)/.test(name)) problems.push(`package.json script "${name}" is a lifecycle hook (it never runs under ignore-scripts); chain the step explicitly`);
  }
  return problems;
}

function trackedFiles() {
  const r = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean);
}

if (isMain(import.meta.url)) {
  try {
    const problems = [];
    let scanned = 0;
    for (const f of trackedFiles()) {
      if (!existsSync(f)) continue; // deleted in the working tree
      const big = statSync(f).size > 2 * 1024 * 1024;
      const name = f.split('/').pop();
      const text = !big && TEXT.test(name) && f !== 'package-lock.json' ? readFileSync(f, 'utf8') : '';
      if (text.includes('\0')) continue;
      scanned++;
      problems.push(...fileProblems(f, text));
    }
    problems.push(...supplyChainProblems({
      pkg: JSON.parse(readFileSync('package.json', 'utf8')),
      npmrc: existsSync('.npmrc') ? readFileSync('.npmrc', 'utf8') : '',
      lockfile: existsSync('package-lock.json'),
    }));
    if (problems.length) {
      console.error(`check-repo: FAIL, ${problems.length} problem(s)\n - ${problems.slice(0, 80).join('\n - ')}`);
      process.exitCode = 1;
    } else console.log(`check-repo: OK (${scanned} tracked files: no secrets, no .env files, no placeholder text in site content; supply-chain settings in place)`);
  } catch (e) {
    console.error(`check-repo: ${e.message}`);
    process.exitCode = 1;
  }
}
