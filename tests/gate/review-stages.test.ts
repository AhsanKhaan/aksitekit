// The code-review and ai-search stages' built-in checks in gate.mjs, each with planted failing cases.
// Everything runs in temporary folders with fake data; the real repo, config and ledger are never touched.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FAIL = 1;
const BLOCKED = 3; // the checks passed and the stage stopped at its npm scripts, which a fake project doesn't have

function project(files: Record<string, string>, bots: Record<string, string> = { aiSearch: 'allow', aiTraining: 'ask' }) {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-review-'));
  temps.push(root);
  mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  cpSync(path.join(REPO, '.claude', 'skills', 'gate'), path.join(root, '.claude', 'skills', 'gate'), { recursive: true });
  cpSync(path.join(REPO, '.claude', 'hooks'), path.join(root, '.claude', 'hooks'), { recursive: true }); // gate.mjs imports secret-patterns.mjs
  cpSync(path.join(REPO, 'package.json'), path.join(root, 'package.json')); // gate.mjs reads the npm script names
  const cfg = { project: { name: 'Example', domain: 'example-site.test' }, hosting: { target: 'cloudflare-pages' }, build: { outputDir: 'out' }, bots };
  writeFileSync(path.join(root, 'factory.config.json'), JSON.stringify(cfg));
  mkdirSync(path.join(root, 'reports'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const gate = (root: string, stage: string) => {
  const r = spawnSync(process.execPath, [path.join(root, '.claude', 'skills', 'gate', 'gate.mjs'), stage, '--dry-run'], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
};

function commit(root: string) {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=fake@example.test', '-c', 'user.name=Fake', 'commit', '-q', '--allow-empty', '-m', 'fake');
  return git('rev-parse', 'HEAD').stdout.trim();
}

const review = (sha: string, verdict = 'PASS', blockers = 0) =>
  `# Code review\nReviewed: ${sha}\nBase: origin/main at ${'b'.repeat(40)}\nVerdict: ${verdict}\nBlockers: ${blockers}\n\n## Findings\nNone [M].\n`;

describe('code-review stage', () => {
  test('a PASS review of HEAD with 0 blockers passes the check', () => {
    const root = project({});
    const head = commit(root);
    writeFileSync(path.join(root, 'reports', 'code-review.md'), review(head));
    const r = gate(root, 'code-review');
    expect(r.status, r.out).toBe(BLOCKED);
    expect(r.out).not.toMatch(/blocker\(s\) open|stale|has no/);
  });

  test('open blockers fail (planted)', () => {
    const root = project({});
    const head = commit(root);
    writeFileSync(path.join(root, 'reports', 'code-review.md'), review(head, 'CHANGES REQUESTED', 2));
    const r = gate(root, 'code-review');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/CHANGES REQUESTED, 2 blocker\(s\) open/);
  });

  test('a review of another commit is stale (planted)', () => {
    const root = project({});
    commit(root);
    writeFileSync(path.join(root, 'reports', 'code-review.md'), review('c'.repeat(40)));
    const r = gate(root, 'code-review');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/the review is stale/);
  });

  test('a report without the verdict lines fails (planted)', () => {
    const root = project({ 'reports/code-review.md': '# Code review\nLooks good to me.\n' });
    commit(root);
    const r = gate(root, 'code-review');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/no "Verdict: PASS" or "Verdict: CHANGES REQUESTED" line/);
  });
});

describe('ai-search stage', () => {
  const report = { 'reports/ai-search.md': '# AI search\nNo blockers [M].\n' };
  const llms = '# Example\n\n> Plain answers about examples.\n\n- [Hub](https://example-site.test/hub/)\n';
  const openRobots = 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n';

  test('llms.txt with a title and robots.txt that follow the bot policy pass the check', () => {
    const r = gate(project({ ...report, 'out/llms.txt': llms, 'out/robots.txt': openRobots }), 'ai-search');
    expect(r.status, r.out).toBe(BLOCKED);
    expect(r.out).not.toMatch(/is blocked|must start with|missing or empty/);
  });

  test('blocks until the site is built', () => {
    const r = gate(project(report), 'ai-search');
    expect(r.status).toBe(BLOCKED);
    expect(r.out).toMatch(/out\/ doesn't exist yet/);
  });

  test('an AI search bot shut out while bots.aiSearch is "allow" fails (planted)', () => {
    const robots = 'User-agent: *\nAllow: /\n\nUser-agent: PerplexityBot\nUser-agent: OAI-SearchBot\nDisallow: /\n';
    const r = gate(project({ ...report, 'out/llms.txt': llms, 'out/robots.txt': robots }), 'ai-search');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/OAI-SearchBot is blocked/);
    expect(r.out).toMatch(/PerplexityBot is blocked/);
  });

  test('a site-wide Disallow catches every bot without its own group (planted)', () => {
    const r = gate(project({ ...report, 'out/llms.txt': llms, 'out/robots.txt': 'User-agent: *\nDisallow: /\n' }), 'ai-search');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/Claude-SearchBot is blocked/);
  });

  test('a training bot let in while bots.aiTraining is "block" fails (planted)', () => {
    const root = project({ ...report, 'out/llms.txt': llms, 'out/robots.txt': openRobots }, { aiSearch: 'allow', aiTraining: 'block' });
    const r = gate(root, 'ai-search');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/ClaudeBot isn't blocked/);
    expect(r.out).not.toMatch(/GPTBot isn't blocked/);
  });

  test('llms.txt without its "# name" title, or missing, fails (planted)', () => {
    const untitled = gate(project({ ...report, 'out/llms.txt': 'Example site\n', 'out/robots.txt': openRobots }), 'ai-search');
    expect(untitled.status).toBe(FAIL);
    expect(untitled.out).toMatch(/must start with "# <site name>"/);
    const missing = gate(project({ ...report, 'out/robots.txt': openRobots }), 'ai-search');
    expect(missing.status).toBe(FAIL);
    expect(missing.out).toMatch(/out\/llms\.txt is missing or empty/);
  });
});
