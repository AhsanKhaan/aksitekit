// check:repo (scripts/check-repo.mjs) and the vulnerability gate (scripts/audit.mjs), with planted failures.
// Fake secrets are built by concatenation so this file itself holds none.
import { describe, expect, it } from 'vitest';
import { fileProblems, supplyChainProblems } from '../../scripts/check-repo.mjs';
import { evaluate, exceptionProblems } from '../../scripts/audit.mjs';

const fakeAwsKey = 'AKIA' + 'Z'.repeat(16);
const fakeGithubToken = 'ghp' + '_' + 'a1'.repeat(18);

describe('check:repo', () => {
  it('fails a committed secret (planted: fake AWS key and GitHub token)', () => {
    expect(fileProblems('lib/config.ts', `const key = '${fakeAwsKey}';`)).toEqual([expect.stringMatching(/lib\/config\.ts:1: looks like a AWS access key id/)]);
    expect(fileProblems('scripts/x.mjs', `\n\ntoken: ${fakeGithubToken}`)).toEqual([expect.stringMatching(/:3: looks like a GitHub token/)]);
  });

  it('fails a committed .env or .dev.vars file whatever it holds', () => {
    expect(fileProblems('.env', '')).toEqual([expect.stringMatching(/a secrets file is committed/)]);
    expect(fileProblems('.dev.vars', '')).toEqual([expect.stringMatching(/a secrets file is committed/)]);
    expect(fileProblems('.env.example', 'SITE_URL=')).toEqual([]);
  });

  it('fails placeholder text that would reach visitors, but not in docs', () => {
    expect(fileProblems('content/pages/x.json', '{"p": "Coming soon"}')).toEqual([expect.stringMatching(/content\/pages\/x\.json:1: placeholder text \(coming soon\)/)]);
    expect(fileProblems('app/page.tsx', '// TODO: write this')).toEqual([expect.stringMatching(/placeholder text \(TODO\)/)]);
    expect(fileProblems('components/X.tsx', 'Lorem ipsum dolor')).toEqual([expect.stringMatching(/lorem ipsum/)]);
    expect(fileProblems('docs/notes.md', 'TODO: later')).toEqual([]);
  });

  it('leaves vendored skills and marked gate fixtures to their own checks', () => {
    expect(fileProblems('vendor/skills/x/SKILL.md', `example: ${fakeAwsKey}`)).toEqual([]);
    expect(fileProblems('tests/x.test.ts', `// secret-scan:allow\n${fakeAwsKey}`)).toEqual([]);
  });

  it('fails loose versions, a missing lockfile, weak .npmrc settings and lifecycle hooks', () => {
    const good = { pkg: { dependencies: { a: '1.2.3' }, scripts: { build: 'x' } }, npmrc: 'ignore-scripts=true\nsave-exact=true\nmin-release-age=7\n', lockfile: true };
    expect(supplyChainProblems(good)).toEqual([]);
    const bad = supplyChainProblems({ pkg: { dependencies: { a: '^1.2.3' }, devDependencies: { b: 'latest' }, scripts: { postinstall: 'x', prebuild: 'y' } }, npmrc: 'save-exact=true\nmin-release-age=3', lockfile: false });
    expect(bad.join('\n')).toMatch(/dependencies\.a = "\^1\.2\.3" is not an exact version/);
    expect(bad.join('\n')).toMatch(/devDependencies\.b = "latest"/);
    expect(bad.join('\n')).toMatch(/must contain "ignore-scripts=true"/);
    expect(bad.join('\n')).toMatch(/min-release-age to 7 days or more/);
    expect(bad.join('\n')).toMatch(/package-lock\.json is missing/);
    expect(bad.join('\n')).toMatch(/"postinstall" is a lifecycle hook/);
    expect(bad.join('\n')).toMatch(/"prebuild" is a lifecycle hook/);
  });

  it('takes an npm alias pinned to an exact version, and fails an alias with a range, a tag or no version', () => {
    const settings = { npmrc: 'ignore-scripts=true\nsave-exact=true\nmin-release-age=7\n', lockfile: true };
    const aliases = { typescript: 'npm:@typescript/typescript6@6.0.2', '@typescript/native': 'npm:typescript@7.0.2' };
    expect(supplyChainProblems({ ...settings, pkg: { devDependencies: aliases } })).toEqual([]);
    const loose = { a: 'npm:@typescript/typescript6@^6.0.2', b: 'npm:typescript@latest', c: 'npm:typescript', d: 'npm:typescript@7.0.2 || 6.0.3' };
    const bad = supplyChainProblems({ ...settings, pkg: { devDependencies: loose } });
    expect(bad).toHaveLength(4);
    for (const name of Object.keys(loose)) expect(bad.join('\n')).toMatch(new RegExp(`devDependencies\\.${name} = .* is not an exact version`));
  });
});

describe('npm audit gate', () => {
  const TODAY = '2026-10-29';
  const ID = 'GHSA-abcd-efgh-ijkl';
  const report = (severity: string) => ({
    metadata: {},
    vulnerabilities: { 'some-pkg': { severity, via: [{ title: 'Prototype pollution', url: `https://github.com/advisories/${ID}`, severity }] } },
  });
  const exception = { id: ID, package: 'some-pkg', reason: 'Only reachable from a build-time script with trusted input', reviewed: '2026-10-20', expires: '2026-12-31' };

  it('fails a high or critical advisory with no exception (planted)', () => {
    expect(evaluate(report('high'), [], TODAY).failures).toEqual([expect.stringMatching(/some-pkg: Prototype pollution \(GHSA-abcd-efgh-ijkl, high\) is neither fixed nor in audit-exceptions\.json/)]);
    expect(evaluate(report('critical'), [], TODAY).failures).toHaveLength(1);
  });

  it('prints moderate and low advisories without failing', () => {
    expect(evaluate(report('moderate'), [], TODAY)).toEqual({ failures: [], notes: [expect.stringMatching(/some-pkg: moderate/)] });
  });

  it('accepts a reviewed exception until it expires', () => {
    expect(evaluate(report('high'), [exception], TODAY).failures).toEqual([]);
    expect(evaluate(report('high'), [{ ...exception, expires: '2026-10-01' }], TODAY).failures).toEqual([expect.stringMatching(/expired on 2026-10-01/)]);
  });

  it('fails when npm audit gives no report', () => {
    expect(evaluate({ error: { summary: 'network down' } }, [], TODAY).failures).toEqual([expect.stringMatching(/no report: network down/)]);
  });

  it('checks the exceptions file itself (planted: no reason, bad id, expired)', () => {
    expect(exceptionProblems([exception], TODAY)).toEqual([]);
    const p = exceptionProblems([{ id: 'CVE-1', package: '', reason: 'ok', reviewed: 'soon', expires: '2026-01-01' }], TODAY).join('\n');
    for (const m of [/"id" must be a GHSA id/, /"package" is empty/, /"reason" must say why/, /"reviewed" must be the owner's review date/, /expired on 2026-01-01/]) expect(p).toMatch(m);
  });
});
