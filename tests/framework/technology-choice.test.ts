// The technology chosen at /start (factory.config.json → build): the build runner and the intake gate.
// Everything runs in temporary folders with fake data; the real config and inputs are never touched.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');
const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'factory-tech-'));
  temps.push(d);
  return d;
};
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const baseConfig = (build: Record<string, unknown>) => ({
  project: { name: 'Example', domain: 'example-site.test', brand: '', locale: 'en', markets: ['US'] },
  hosting: { target: 'cloudflare-pages', productionBranch: 'main' },
  build,
  competitors: [{ domain: 'rival-one.test', dr: 12 }, { domain: 'rival-two.test', dr: 30 }],
});

function runFramework(build: Record<string, unknown>, mode = 'build') {
  const dir = temp();
  const cfg = path.join(dir, 'factory.config.json');
  writeFileSync(cfg, JSON.stringify(baseConfig(build)));
  return spawnSync(process.execPath, [path.join(REPO, 'scripts', 'framework.mjs'), mode], {
    cwd: dir,
    env: { ...process.env, FACTORY_CONFIG: cfg },
    encoding: 'utf8',
  });
}

describe('scripts/framework.mjs runs the chosen technology', () => {
  test('refuses to build before a technology is chosen', () => {
    const r = runFramework({ framework: '', outputDir: 'out', commands: { build: 'node -e "0"' } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/build\.framework is empty/);
  });
  test('refuses an output folder outside the repo', () => {
    for (const outputDir of ['../site', '/abs/out', 'a/../../b', '']) {
      const r = runFramework({ framework: 'astro', outputDir, commands: { build: 'node -e "0"' } });
      expect(r.status, outputDir).toBe(1);
      expect(r.stderr).toMatch(/outputDir/);
    }
  });
  test('refuses a technology with no command for the mode', () => {
    const r = runFramework({ framework: 'hugo', outputDir: 'public', commands: { build: 'hugo' } }, 'dev');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/build\.commands\.dev is empty for "hugo"/);
  });
  test('runs the configured command and passes the output folder to it', () => {
    const ok = runFramework({
      framework: 'eleventy',
      outputDir: 'dist',
      commands: { build: 'node -e "process.exit(process.env.SITE_OUTPUT_DIR===\'dist\'?0:3)"' },
    });
    expect(ok.status).toBe(0);
    const failing = runFramework({ framework: 'eleventy', outputDir: 'dist', commands: { build: 'node -e "process.exit(4)"' } });
    expect(failing.status).toBe(4);
  });
});

describe('intake gate checks the technology choice', () => {
  function intake(build: Record<string, unknown>, csv = 'domain,dr,notes\nrival-one.test,12,\nrival-two.test,30,\n') {
    const root = temp();
    mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
    cpSync(path.join(REPO, '.claude', 'skills', 'gate'), path.join(root, '.claude', 'skills', 'gate'), { recursive: true });
    cpSync(path.join(REPO, '.claude', 'hooks'), path.join(root, '.claude', 'hooks'), { recursive: true }); // gate.mjs imports secret-patterns.mjs
    cpSync(path.join(REPO, 'package.json'), path.join(root, 'package.json')); // gate.mjs reads the npm script names
    mkdirSync(path.join(root, 'research', 'inputs'), { recursive: true });
    writeFileSync(path.join(root, 'factory.config.json'), JSON.stringify(baseConfig(build)));
    writeFileSync(path.join(root, 'research', 'inputs', 'competitors.csv'), csv);
    return spawnSync(process.execPath, [path.join(root, '.claude', 'skills', 'gate', 'gate.mjs'), 'intake'], { cwd: root, encoding: 'utf8' });
  }
  const nextjs = { framework: 'nextjs', outputDir: 'out', commands: { build: 'next build', dev: 'next dev' } };

  test('passes with Next.js and names the seed and technology', () => {
    const r = intake(nextjs);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/rival-one\.test/);
    expect(r.stdout + r.stderr).toMatch(/technology nextjs → out\//);
  });
  test('passes with another technology and its own output folder', () => {
    const r = intake({ framework: 'astro', outputDir: 'dist', commands: { build: 'astro build' } });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
  test('fails while no technology is chosen', () => {
    const r = intake({ ...nextjs, framework: '' });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/build\.framework is empty/);
  });
  test('fails without a build command', () => {
    const r = intake({ framework: 'hugo', outputDir: 'public', commands: {} });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/build\.commands\.build is empty/);
  });
  test('accepts the optional brands column the keyword pipeline reads', () => {
    const r = intake(nextjs, 'domain,dr,notes,brands\nrival-one.test,12,,Rival One\nrival-two.test,30,,\n');
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
