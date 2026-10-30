// The design stage through the gate: gate.mjs design checks DESIGN.md's structure, then runs the official DESIGN.md
// linter (`npm run lint:design`, @google/design.md) and the contrast gate (`npm run gate:design`). A valid DESIGN.md
// passes both; a planted error fails at lint:design; without node_modules the stage is BLOCKED, not FAIL.
// Everything runs in temporary folders; the real repo and ledger are never touched.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PASS = 0;
const FAIL = 1;
const BLOCKED = 3;
const NPM = 60_000; // each case spawns npm once or twice

// The template with its placeholders filled in: its starter tokens pass the linter and the contrast gate.
const VALID = readFileSync(path.join(REPO, 'docs', 'templates', 'DESIGN.md'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\{\{[A-Z0-9_]+\}\}/g, 'Example');
const plant = (from: string, to: string) => {
  if (!VALID.includes(from)) throw new Error(`the DESIGN.md template no longer has ${JSON.stringify(from)}`);
  return VALID.replace(from, to);
};

function project(design: string, modules = true) {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-design-'));
  temps.push(root);
  for (const dir of ['.claude/skills/gate', '.claude/hooks', 'scripts/design', 'scripts/lib']) {
    cpSync(path.join(REPO, ...dir.split('/')), path.join(root, ...dir.split('/')), { recursive: true });
  }
  cpSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'));
  // gate.mjs only checks that node_modules exists; the linter itself runs from the repo's install (PATH below).
  if (modules) mkdirSync(path.join(root, 'node_modules'));
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs', 'DESIGN.md'), design);
  return root;
}

// Windows names the variable Path: reuse its key, or the child gets two.
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
function gate(root: string) {
  const env = { ...process.env, [PATH_KEY]: [path.join(REPO, 'node_modules', '.bin'), process.env[PATH_KEY]].join(path.delimiter) };
  const r = spawnSync(process.execPath, [path.join(root, '.claude', 'skills', 'gate', 'gate.mjs'), 'design', '--dry-run'], { cwd: root, encoding: 'utf8', env });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe('design stage: lint:design, then gate:design', () => {
  test('a valid DESIGN.md passes the linter and goes on to the contrast gate', () => {
    const r = gate(project(VALID));
    expect(r.status, r.out).toBe(PASS);
    expect(r.out).toMatch(/\*\*0 errors\*\*/);
    expect(r.out).toContain('npm run lint:design ok');
    expect(r.out).toContain('npm run gate:design ok');
  }, NPM);

  test('a broken token reference fails at lint:design (planted)', () => {
    const r = gate(project(plant('textColor: "{colors.primary}"', 'textColor: "{colors.nope}"')));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/npm run lint:design exited 1: .*Reference \{colors\.nope\} does not resolve/);
    expect(r.out).not.toContain('> npm run gate:design');
  }, NPM);

  test('a colour that is not a colour fails at lint:design, though no contrast pair uses it (planted)', () => {
    const r = gate(project(plant('  error: "#B91C1C"\n', '  error: "#B91C1C"\n  accent: "blue-ish"\n')));
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/npm run lint:design exited 1: .*'blue-ish' is not a valid color/);
  }, NPM);

  test('without node_modules the stage is BLOCKED until npm ci, not FAIL', () => {
    const r = gate(project(VALID, false));
    expect(r.status).toBe(BLOCKED);
    expect(r.out).toMatch(/npm run lint:design can't run yet; missing: node_modules \(run npm ci\)/);
  });
});
