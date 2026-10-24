// PostToolUse check after every file edit (see .claude/settings.json):
//   1. secret scan of the edited file (rule name and line only, never the value);
//   2. ESLint on the edited file, once Step C has installed ESLint and added eslint.config.mjs.
// Exit code 2 sends the message back to Claude so it fixes the file. A file that holds clearly fake test secrets
// (planted gate cases) carries the marker `secret-scan:allow` and is skipped by step 1.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSecrets } from './secret-patterns.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINTABLE = /\.(?:[cm]?js|jsx|tsx?|mts|cts)$/i;

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
if (!file || !existsSync(file)) process.exit(0);
const stat = statSync(file);
if (!stat.isFile() || stat.size > 2 * 1024 * 1024) process.exit(0);

const text = readFileSync(file, 'utf8');
if (text.includes('\0')) process.exit(0);
const rel = path.relative(ROOT, file) || file;
const problems = [];

if (!text.includes('secret-scan:allow')) {
  for (const hit of findSecrets(text)) problems.push(`secret-scan: ${rel}:${hit.line} looks like a ${hit.rule}.`);
  if (problems.length) {
    problems.push('Never write real secrets into files: use an environment variable name and ask the owner to set it. ' +
      "If this is a clearly fake fixture, add the comment 'secret-scan:allow' to the file.");
  }
}

const eslintBin = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (LINTABLE.test(file) && existsSync(eslintBin) && existsSync(path.join(ROOT, 'eslint.config.mjs'))) {
  const r = spawnSync(process.execPath, [eslintBin, '--no-warn-ignored', file], { cwd: ROOT, encoding: 'utf8', timeout: 45000 });
  if (r.status === 1) {
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/).slice(0, 40).join('\n');
    problems.push(`eslint: ${rel} has lint errors:\n${out}`);
  }
}

if (problems.length) {
  process.stderr.write(problems.join('\n') + '\n');
  process.exit(2);
}
process.exit(0);
