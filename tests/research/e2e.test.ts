// End to end on the fake examples: research/inputs/examples/ copied into a temp project, never the real inputs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkMap } from '../../scripts/research/lib/cluster.mjs';
import { REPO, cleanupProjects, readOut, readOutJson, run, tempProject } from './helpers';

const EXAMPLES = join(REPO, 'research', 'inputs', 'examples');
let root: string;

beforeAll(() => {
  root = tempProject({});
  cpSync(EXAMPLES, join(root, 'research', 'inputs'), { recursive: true });
});
afterAll(cleanupProjects);

describe('ingest → select → cluster on the fake examples', () => {
  it('runs every stage cleanly', () => {
    for (const script of ['kp-ingest', 'keyword-select', 'cluster'] as const) {
      const r = run(script, root);
      expect(r.code, `${script}: ${r.stderr}`).toBe(0);
    }
  });

  it('ingests the UTF-16 LE export and the UTF-8 re-save, merging keywords across competitors', () => {
    const k = readOutJson(root, 'keywords.json');
    expect(k.files.map((f: { encoding: string; delimiter: string }) => [f.encoding, f.delimiter])).toEqual([['utf-16le', 'tab'], ['utf-8', ',']]);
    const calc = k.keywords.find((x: { keyword: string }) => x.keyword === 'example widget sizer calculator');
    expect(calc).toMatchObject({
      volume: { min: 2400, label: 'M' },
      sources: ['sizerpal.example', 'widgetwise.example'],
      variants: ['example widgetsizer calculator'],
      kd: 18,
      kdSource: 'serp-check',
    });
    const bucket = k.keywords.find((x: { keyword: string }) => x.keyword === 'example widgets');
    expect(bucket.volume).toEqual({ min: 10000, max: 100000, label: 'R', raw: '10K – 100K' });
  });

  it('rejects for every reason and queues the keywords without KD', () => {
    const s = readOutJson(root, 'selected.json');
    const reasons = Object.fromEntries(s.rejected.map((x: { keyword: string; reason: string }) => [x.keyword, x.reason]));
    expect(reasons).toEqual({
      'sizerpal widget sizer': 'brand',
      'widget wise sizer': 'brand',
      'example widget sizer app': 'kd',
      'example widget sizers': 'low-volume',
      'example gadget': 'low-volume',
      'example christmas widget planner': 'seasonal',
      'example summer gadget fan': 'seasonal',
    });
    expect(s.pending.map((x: { keyword: string }) => x.keyword)).toEqual(['how to clean an example gizmo', 'example gizmo sizer']);
    expect(readOut(root, 'kd-todo.csv')).toBe(
      'keyword,kd,source,checked,volume\nhow to clean an example gizmo,,,,1900\nexample gizmo sizer,,,,1000-10000\n');
    expect(s.counts).toMatchObject({ input: 25, selected: 16, pendingKd: 2, rejected: 7 });
  });

  it('maps every selected keyword to exactly one URL or discarded[]', () => {
    const s = readOutJson(root, 'selected.json');
    const m = readOutJson(root, 'keyword-map.json');
    expect(checkMap(m, { cap: 10, selected: s.selected })).toEqual([]);
    expect(m.pendingKd).toBe(2);
    expect(m.pages.map((p: { type: string; url: string }) => `${p.type} ${p.url}`)).toEqual([
      'tool /gadgets/example-gadget-converter/',
      'instance /gadgets/example-gadget-converter/example-gadget-weight-converter/',
      'guide /uncategorized/example-gizmo-cost/',
      'tool /widget/example-widget-cost-calculator/',
      'tool /widget/example-widget-sizer-calculator/',
      'guide /widget/example-widget-sizer-calculator/example-widget-sizer-chart/',
      'guide /widget/example-widget-sizer-calculator/what-is-an-example-widget-sizer/',
      'hub /widget/example-widgets/',
      'guide /widget/example-widgets/how-to-measure-an-example-widget/',
    ]);
    expect(m.discarded).toMatchObject([{ keyword: 'online calculator', reason: 'generic' }]);
    const owned = m.pages.flatMap((p: { primary: string; secondary: string[] }) => [p.primary, ...p.secondary])
      .concat(m.discarded.map((d: { keyword: string }) => d.keyword)).sort();
    expect(owned).toEqual(s.selected.map((x: { keyword: string }) => x.keyword).sort());
  });

  it('gives identical files on a second run', () => {
    const before = ['keywords.json', 'selected.json', 'kd-todo.csv', 'keyword-map.json'].map((f) => readOut(root, f));
    for (const script of ['kp-ingest', 'keyword-select', 'cluster'] as const) expect(run(script, root).code).toBe(0);
    const after = ['keywords.json', 'selected.json', 'kd-todo.csv', 'keyword-map.json'].map((f) => readOut(root, f));
    expect(after).toEqual(before);
  });

  it('works through `npm run research:all` with FACTORY_ROOT', () => {
    const r = spawnSync('npm run research:all', {
      cwd: REPO, env: { ...process.env, FACTORY_ROOT: root }, encoding: 'utf8', shell: true,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/cluster: 9 pages/);
  }, 60_000);

  it('never touched the real research/inputs/', () => {
    const real = join(REPO, 'research', 'inputs');
    expect(existsSync(join(real, 'kd.csv'))).toBe(false);
    expect(existsSync(join(real, 'competitors.csv'))).toBe(false);
    const kp = join(real, 'kp');
    if (existsSync(kp)) expect(readdirSync(kp).filter((f) => !f.startsWith('.'))).toEqual([]);
  });

  it('keeps the examples clearly fake', () => {
    const competitors = readFileSync(join(EXAMPLES, 'competitors.csv'), 'utf8');
    for (const line of competitors.trim().split('\n').slice(1)) expect(line).toMatch(/^[a-z]+\.example,\d+,FAKE/);
    const k = readOutJson(root, 'keywords.json');
    const brands = ['sizerpal', 'widget wise'];
    for (const x of k.keywords as { keyword: string }[]) {
      expect(x.keyword.includes('example') || x.keyword === 'online calculator' || brands.some((b) => x.keyword.startsWith(b)), x.keyword).toBe(true);
    }
  });
});
