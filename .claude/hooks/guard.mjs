// PreToolUse guard (see .claude/settings.json). Blocks, with exit code 2 and a reason Claude can read:
//   - reading or writing secrets files (.env* except .env.example, .dev.vars*, keys, credential stores);
//   - shell commands that print secrets (bare `env`/`printenv`, `Get-ChildItem env:`, echoing *_TOKEN/*_SECRET vars);
//   - `git push` to the production branch, force pushes, `--all`/`--mirror`, and skipping hooks (`--no-verify`);
//   - hand deploys with wrangler (production deploys run from the deploy workflow after the owner's GO).
// Anything it can't parse is allowed: this is a guard rail on top of the permission rules, not a sandbox.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSecretPath } from './secret-patterns.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function block(reason) {
  process.stderr.write(`guard: ${reason}\n`);
  process.exit(2);
}

function protectedBranches() {
  const set = new Set(['main']);
  try {
    const cfg = JSON.parse(readFileSync(path.join(ROOT, 'factory.config.json'), 'utf8'));
    if (cfg?.hosting?.productionBranch) set.add(String(cfg.hosting.productionBranch));
  } catch {
    // no config yet: protect main only
  }
  return set;
}

const SECRET_VAR = /\$(?:\{|env:)?[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|_PAT)\b/i;
const SECRET_NAME = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|_PAT)$/i;

function segments(command) {
  // Message text (heredoc bodies, -m/--body/--title values) is prose, not commands: mask it before splitting, so a
  // commit message that mentions ".env" or "push to main" isn't mistaken for the act.
  const masked = command
    .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g, '<<MSG')
    .replace(/(\s(?:-m|--message|--body|--title|--notes|-t|-b)(?:=|\s+))("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1MSG');
  // Split on shell separators; good enough for the commands agents run.
  return masked.split(/\r?\n|&&|\|\||[;|&]/).map((s) => s.trim()).filter(Boolean);
}

function tokens(segment) {
  return segment.split(/\s+/).map((t) => t.replace(/^["'`(]+|["'`)]+$/g, '')).filter(Boolean);
}

function checkSecretsInShell(segment) {
  const toks = tokens(segment);
  if (toks.length === 0) return;
  const cmd = toks[0].toLowerCase().replace(/\.exe$/, '');
  const pathTokens = segment.split(/[\s"'`=;|&<>(),]+/).filter(Boolean);
  const gitSafe = cmd === 'git' && ['check-ignore', 'status', 'ls-files', 'rm'].includes((toks[1] || '').toLowerCase());
  if (!gitSafe && pathTokens.some(isSecretPath)) {
    block('this command touches a secrets file (.env*, .dev.vars, keys or a credential store). Those are the owner\'s. ' +
      'Refer to secrets by variable name only; `.env.example` is fine.');
  }
  if ((cmd === 'env' || cmd === 'printenv') && toks.length === 1) block('printing the whole environment can expose secrets.');
  if (cmd === 'printenv' && toks.slice(1).some((t) => SECRET_NAME.test(t))) block('printing a secret variable is not allowed.');
  if (cmd === 'set' && toks.length === 1) block('printing the whole environment can expose secrets.');
  if (/^(get-childitem|gci|dir|ls|get-item)$/.test(cmd) && toks.slice(1).some((t) => /^env:/i.test(t))) {
    block('listing env: can expose secrets.');
  }
  if (/^(echo|printf|write-output|write-host|print)$/.test(cmd) && SECRET_VAR.test(segment)) {
    block('echoing a secret variable is not allowed. Check whether it is set with a test that prints yes/no instead.');
  }
}

function currentBranch(cwd) {
  try {
    // --show-current also works on a branch with no commits yet.
    return execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function checkGit(segment, cwd) {
  const toks = tokens(segment);
  // git must be the command itself (optionally after VAR=value assignments), not a word in some text.
  const gi = toks.findIndex((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  if (gi === -1 || !/^git(\.exe)?$/i.test(toks[gi])) return;
  let i = gi + 1;
  let gitCwd = cwd;
  while (i < toks.length && toks[i].startsWith('-')) {
    if (toks[i] === '-C' && toks[i + 1]) { gitCwd = path.resolve(cwd, toks[i + 1]); i += 2; continue; }
    if (toks[i] === '-c' && toks[i + 1]) { i += 2; continue; }
    i += 1;
  }
  const sub = (toks[i] || '').toLowerCase();
  const args = toks.slice(i + 1);
  if (sub === 'commit' && args.some((a) => a === '--no-verify' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a))) {
    block('never skip git hooks (--no-verify). Fix what the hook reports instead.');
  }
  if (sub !== 'push') return;
  const prod = protectedBranches();
  const flags = args.filter((a) => a.startsWith('-'));
  const positional = args.filter((a) => !a.startsWith('-'));
  if (flags.some((f) => f === '--no-verify')) block('never skip git hooks (--no-verify).');
  if (flags.some((f) => /^--force/.test(f) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(f))) {
    block('force-pushing is not allowed. If history really must be rewritten, the owner does it.');
  }
  if (flags.some((f) => f === '--all' || f === '--mirror')) block(`--all/--mirror would push ${[...prod].join('/')}.`);
  const refspecs = positional.slice(1);
  for (const r of refspecs) {
    if (r.startsWith('+')) block('force-pushing (+refspec) is not allowed.');
    let dst = (r.includes(':') ? r.split(':').pop() : r).replace(/^refs\/heads\//, '');
    if (dst === 'HEAD' || dst === '@') dst = currentBranch(gitCwd);
    if (prod.has(dst)) block(`pushing to ${dst} is not allowed. Push a branch and open a pull request; the owner's GO ships it.`);
  }
  if (refspecs.length === 0) {
    const b = currentBranch(gitCwd);
    if (prod.has(b)) block(`you are on ${b}; a bare git push would push it. Create a branch first.`);
  }
}

function checkDeploy(segment) {
  const toks = tokens(segment).map((t) => t.toLowerCase());
  const wi = toks.findIndex((t) => /^wrangler(\.cmd|\.exe)?$/.test(t));
  if (wi === -1) return;
  const rest = toks.slice(wi + 1);
  if (rest.includes('deploy') || rest.includes('publish') || (rest[0] === 'versions' && rest.includes('upload'))) {
    block('deploys run from the deploy workflow after the owner\'s GO, never by hand. Use /deploy-production.');
  }
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
const tool = input.tool_name || '';
const ti = input.tool_input || {};
const cwd = input.cwd || process.cwd();

if (tool === 'Bash' || tool === 'PowerShell') {
  const command = String(ti.command || '');
  for (const seg of segments(command)) {
    checkSecretsInShell(seg);
    checkGit(seg, cwd);
    checkDeploy(seg);
  }
} else if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const p = ti.file_path || ti.notebook_path || '';
  if (isSecretPath(p)) block(`${p} is a secrets file; agents never read or write it. Ask the owner, and refer to secrets by name.`);
} else if (tool === 'Grep' || tool === 'Glob') {
  if (isSecretPath(ti.path) || isSecretPath(ti.glob)) block('searching inside secrets files is not allowed.');
} else if (/^mcp__.*cloudflare.*__execute$/i.test(tool)) {
  // Cloudflare API MCP (code mode): reads run freely; every write waits for the owner's yes; deletes never run.
  const code = String(ti.code || '');
  const methods = [
    ...[...code.matchAll(/\bmethod\s*:\s*(["'`])?([A-Za-z]+)?\1?/g)].map((m) => (m[1] && m[2] ? m[2].toUpperCase() : '?')),
    ...[...code.matchAll(/\.(post|put|patch|delete)\s*\(/gi)].map((m) => m[1].toUpperCase()),
  ];
  if (methods.includes('DELETE')) block('deleting anything in Cloudflare is never done by an agent. The owner does it in the dashboard.');
  const writes = methods.filter((m) => !['GET', 'HEAD'].includes(m));
  if (writes.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `Cloudflare write (${[...new Set(writes)].join(', ')}): the owner must approve this exact call. ` +
          'Check the method, path, body, effect and how to undo it before saying yes.',
      },
    }));
  }
}
process.exit(0);
