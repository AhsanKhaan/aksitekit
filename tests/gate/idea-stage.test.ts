// The owner's idea through the gate: recon's idea section, the idea stage's built-in check, the two approval stages
// pinned by content hash, and the build and GO refusing a stale approval. Each rule has a planted failing case.
// Everything runs in temporary folders with fake data; the real repo, config and ledger are never touched.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');
const STAGES: { id: string }[] = JSON.parse(readFileSync(path.join(REPO, '.claude', 'skills', 'gate', 'stages.json'), 'utf8')).stages;
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PASS = 0;
const FAIL = 1;
const USAGE = 2;
const BLOCKED = 3;

const OWNER_WORDS = 'A free site where people sizing example widgets type their measurements and get the right size.';
const IDEA_INPUT = `# The idea\n\n## In the owner's words\n${OWNER_WORDS}\n\n## Owner answers\n`;
const recon = (domain: string, idea = true) =>
  `# ${domain}\n\nSources: https://${domain}/ (2026-10-30)\n\n## Page types\nOne calculator page.\n\n` +
  (idea ? "## Against the owner's idea\nSizing widgets: partly, a calculator below the fold.\n" : '');

const SECTIONS = {
  own: "## 1. The owner's idea\n> A free site where people sizing example widgets type their measurements\n> and get the right size.\n\nA widget-size calculator with a short guide.\n",
  jobs: '## 2. Visitors and their jobs\n| Job | Statement | Dimension | From |\n|---|---|---|---|\n| J1 | When I order a widget, I want the right size, so I can skip a return | functional | owner\'s idea |\n| J2 | When a size looks odd, I want it explained, so I can trust it | emotional | rival-one.test recon |\n',
  cover: '## 3. Coverage by competitor\n| Job | rival-one.test | rival-two.test | Best today |\n|---|---|---|---|\n| J1 | partly | no | rival-one.test |\n| J2 | no | partly | none |\n',
  win: '## 4. Where we can win\nNobody explains the size [P].\n',
  features: '## 5. Features\n| Feature | Job | Priority | Page type | Evidence |\n|---|---|---|---|---|\n| Size calculator | J1 | must | tool | owner\'s idea; rival-one.test recon |\n| What the size means | J2 | should | guide | rival-two.test recon |\n',
  wave: '## 6. Wave 1\nThe calculator and its guide.\n',
  position: '## 7. Positioning\nFor widget buyers who hate returns, Example gives the size in one step.\n',
  scope: '## 8. Out of scope\nAccounts.\n',
  open: '## 9. Open questions for the owner\nNone.\n',
};
type Part = keyof typeof SECTIONS;
const idea = (change: Partial<Record<Part, string>> = {}) =>
  `# Idea: Example\n\n${Object.keys(SECTIONS).map((k) => change[k as Part] ?? SECTIONS[k as Part]).join('\n')}`;
const DESIGN = '---\nname: Example\ncolors:\n  primary: "#1a1a1a"\ntypography:\n  body: Inter\n---\n\n## Overview\nPlain.\n';

const hash = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);

function project(files: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-idea-'));
  temps.push(root);
  mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  cpSync(path.join(REPO, '.claude', 'skills', 'gate'), path.join(root, '.claude', 'skills', 'gate'), { recursive: true });
  cpSync(path.join(REPO, '.claude', 'hooks'), path.join(root, '.claude', 'hooks'), { recursive: true }); // gate.mjs imports secret-patterns.mjs
  cpSync(path.join(REPO, 'package.json'), path.join(root, 'package.json')); // gate.mjs reads the npm script names
  const cfg = { project: { name: 'Example', domain: 'example-site.test' }, hosting: { target: 'cloudflare-pages' }, build: { outputDir: 'out' } };
  const all: Record<string, string> = {
    'factory.config.json': JSON.stringify(cfg),
    'research/inputs/competitors.csv': 'domain,dr,notes\nrival-one.test,12,\nrival-two.test,30,\n',
    'research/inputs/idea.md': IDEA_INPUT,
    'research/out/recon/rival-one.test.md': recon('rival-one.test'),
    'research/out/recon/rival-two.test.md': recon('rival-two.test'),
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const run = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [path.join(root, '.claude', 'skills', 'gate', 'gate.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
};
const gate = (root: string, stage: string) => run(root, stage, '--dry-run');

// A ledger where every stage before `until` passed, with the given evidence for some of them.
function ledger(root: string, until: string, evidence: Record<string, string> = {}) {
  const rows = STAGES.slice(0, STAGES.findIndex((s) => s.id === until))
    .map((s) => `| 2026-10-30T10:00Z | ${s.id} | fake | 1 | PASS | fake | ${evidence[s.id] ?? 'ok'} | next |`);
  mkdirSync(path.join(root, 'reports'), { recursive: true });
  writeFileSync(path.join(root, 'reports', 'ledger.md'), `# Pipeline ledger\n\n| When (UTC) | Stage | Agent | Attempt | Result | Gate | Evidence | Next |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
}

describe('recon stage: the owner\'s idea', () => {
  test('recon files with an "Against the owner\'s idea" section pass', () => {
    const r = gate(project(), 'recon');
    expect(r.status, r.out).toBe(PASS);
  });

  test('a recon file without it fails (planted)', () => {
    const r = gate(project({ 'research/out/recon/rival-two.test.md': recon('rival-two.test', false) }), 'recon');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/rival-two\.test\.md has no "## Against the owner's idea" section/);
  });
});

describe('idea stage', () => {
  test('a groomed idea that covers every job and competitor passes, and prints the hash to approve', () => {
    const text = idea();
    const r = gate(project({ 'docs/IDEA.md': text }), 'idea');
    expect(r.status, r.out).toBe(PASS);
    expect(r.out).toContain(`APPROVE ${hash(text)}`);
    expect(r.out).toMatch(/2 job\(s\), 2 feature\(s\) \(1 must\), 2 competitor\(s\) matched/);
  });

  test("the owner's words reworded fails (planted)", () => {
    const own = "## 1. The owner's idea\n> A free website where people sizing example widgets enter measurements and get a size.\n";
    const r = gate(project({ 'docs/IDEA.md': idea({ own }) }), 'idea');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/must quote research\/inputs\/idea\.md/);
  });

  test('a missing section fails (planted)', () => {
    const r = gate(project({ 'docs/IDEA.md': idea({ position: '' }) }), 'idea');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/has no "## 7\. Positioning" section/);
  });

  test('a competitor left out of the coverage fails (planted)', () => {
    const cover = '## 3. Coverage by competitor\n| Job | rival-one.test |\n|---|---|\n| J1 | partly |\n| J2 | no |\n';
    const r = gate(project({ 'docs/IDEA.md': idea({ cover }) }), 'idea');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/§3 doesn't cover rival-two\.test/);
  });

  test('a feature without evidence fails (planted)', () => {
    const features = SECTIONS.features.replace('| rival-two.test recon |', '| — |');
    const r = gate(project({ 'docs/IDEA.md': idea({ features }) }), 'idea');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/"What the size means" has no evidence/);
  });

  test('a job with no feature fails (planted)', () => {
    const features = SECTIONS.features.split('\n').filter((l) => !l.includes('J2')).join('\n');
    const r = gate(project({ 'docs/IDEA.md': idea({ features }) }), 'idea');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/no feature for J2/);
  });

  test('no "must" feature fails (planted)', () => {
    const r = gate(project({ 'docs/IDEA.md': idea({ features: SECTIONS.features.replace('| must |', '| could |') }) }), 'idea');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/no "must" feature/);
  });

  test('a long quote outside the owner\'s sections fails (planted)', () => {
    const win = '## 4. Where we can win\nOne review said "the calculator is buried under three ads and a long story about the history of widget sizes".\n';
    const r = gate(project({ 'docs/IDEA.md': idea({ win }) }), 'idea');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/IDEA\.md:\d+ quotes more than 15 words/);
  });

  test('an unanswered question for the owner blocks it', () => {
    const open = "## 9. Open questions for the owner\n- [x] Metric too? → yes, both (owner, 2026-10-30)\n- [ ] Should the guide come before the calculator?\n";
    const r = gate(project({ 'docs/IDEA.md': idea({ open }) }), 'idea');
    expect(r.status).toBe(BLOCKED);
    expect(r.out).toMatch(/1 unanswered question\(s\) for the owner/);
  });

  test('a template placeholder left in fails (planted)', () => {
    const r = gate(project({ 'docs/IDEA.md': idea({ wave: '## 6. Wave 1\n{{WAVE1_SLICE}}\n' }) }), 'idea');
    expect(r.status).toBe(FAIL);
    expect(r.out).toMatch(/template placeholder/);
  });
});

describe('approval stages', () => {
  test('the manual stage shows the hash the owner types', () => {
    const text = idea();
    const r = gate(project({ 'docs/IDEA.md': text }), 'idea-approval');
    expect(r.status).toBe(BLOCKED);
    expect(r.out).toContain(`types APPROVE ${hash(text)}`);
  });

  test('records the owner\'s APPROVE for the file as it is now', () => {
    const text = idea();
    const root = project({ 'docs/IDEA.md': text });
    ledger(root, 'idea-approval');
    const r = run(root, 'record', 'idea-approval', 'PASS', `owner typed: APPROVE ${hash(text)}`);
    expect(r.status, r.out).toBe(PASS);
    expect(readFileSync(path.join(root, 'reports', 'ledger.md'), 'utf8')).toContain(`| idea-approval | owner | 1 | PASS | gate.mjs record idea-approval | owner typed: APPROVE ${hash(text)} |`);
  });

  test('refuses an APPROVE for another version of the file (planted)', () => {
    const root = project({ 'docs/IDEA.md': idea() });
    ledger(root, 'idea-approval');
    const r = run(root, 'record', 'idea-approval', 'PASS', 'owner typed: APPROVE 0123456789ab');
    expect(r.status).toBe(USAGE);
    expect(r.out).toMatch(/the owner approved 0123456789ab, but docs\/IDEA\.md is [0-9a-f]{12} now/);
  });

  test('refuses evidence without the owner\'s APPROVE (planted)', () => {
    const root = project({ 'docs/IDEA.md': idea() });
    ledger(root, 'idea-approval');
    const r = run(root, 'record', 'idea-approval', 'PASS', 'looks fine');
    expect(r.status).toBe(USAGE);
    expect(r.out).toMatch(/needs the owner's words, e\.g\. "owner typed: APPROVE [0-9a-f]{12}"/);
  });
});

describe('build and GO refuse a stale approval', () => {
  const approved = (ideaText: string, designText: string) => ({
    'idea-approval': `owner typed: APPROVE ${hash(ideaText)}`,
    'design-approval': `owner typed: APPROVE ${hash(designText)}`,
  });

  test('approvals that match both files let build go on to its npm gate', () => {
    const root = project({ 'docs/IDEA.md': idea(), 'docs/DESIGN.md': DESIGN });
    ledger(root, 'build', approved(idea(), DESIGN));
    const r = gate(root, 'build');
    expect(r.status).toBe(BLOCKED);
    expect(r.out).toMatch(/npm run verify can't run yet/);
    expect(r.out).not.toMatch(/approved it|hasn't approved/);
  });

  test('blocks build until the owner approves (planted)', () => {
    const root = project({ 'docs/IDEA.md': idea(), 'docs/DESIGN.md': DESIGN });
    const r = gate(root, 'build');
    expect(r.status).toBe(BLOCKED);
    expect(r.out).toMatch(/the owner hasn't approved docs\/IDEA\.md/);
  });

  test('blocks build when DESIGN.md changed after the approval (planted)', () => {
    const root = project({ 'docs/IDEA.md': idea(), 'docs/DESIGN.md': `${DESIGN}\nA late change.\n` });
    ledger(root, 'build', approved(idea(), DESIGN));
    const r = gate(root, 'build');
    expect(r.status).toBe(BLOCKED);
    expect(r.out).toMatch(/docs\/DESIGN\.md changed since the owner approved it/);
  });

  test('refuses the GO when IDEA.md changed after the approval (planted)', () => {
    const root = project({ 'docs/IDEA.md': idea({ scope: '## 8. Out of scope\nAccounts and comments.\n' }), 'docs/DESIGN.md': DESIGN });
    ledger(root, 'go', approved(idea(), DESIGN));
    const r = run(root, 'record', 'go', 'PASS', 'owner typed: GO 1a2b3c4');
    expect(r.status).toBe(USAGE);
    expect(r.out).toMatch(/no GO while an approval is out of date: docs\/IDEA\.md changed/);
  });
});
