import { afterAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { selectKeywords } from '../../scripts/research/lib/select.mjs';
import { brandLabel, brandTerms, matchesBrand, normalizeDomain, tokenize } from '../../scripts/research/lib/inputs.mjs';
import { DEFAULT_RESEARCH, cleanupProjects, flat, readOut, readOutJson, row, run, tempProject, utf16Export } from './helpers';

afterAll(cleanupProjects);

const config = { minVolume: 1000, maxKd: 30, maxSeasonality: 2.5 };
const kdMap = (entries: [string, number][]) => new Map(entries.map(([k, kd]) => [k.replaceAll(' ', ''), { keyword: k, kd, source: 'serp-check', checked: null }]));
const competitors = [
  { domain: 'sizerpal.example', brands: brandTerms('sizerpal.example') },
  { domain: 'widgetwise.example', brands: brandTerms('widgetwise.example', 'Widget Wise') },
];

describe('selectKeywords', () => {
  it('rejects seasonal keywords (peak / median above maxSeasonality, or unknown)', () => {
    const r = selectKeywords([
      row('example christmas widget planner', { seasonality: 100 }),
      row('example widget sizer', { seasonality: 2.5 }),
      row('example gadget converter', { seasonality: null }),
    ], { config, kd: kdMap([['example christmas widget planner', 5], ['example widget sizer', 5], ['example gadget converter', 5]]), competitors: [] });
    expect(r.selected.map((x) => x.keyword)).toEqual(['example widget sizer']);
    expect(r.rejected.map((x) => [x.keyword, x.reason])).toEqual([
      ['example christmas widget planner', 'seasonal'],
      ['example gadget converter', 'seasonal'],
    ]);
    expect(r.rejected[0].detail).toMatch(/peak\/median 100 is above maxSeasonality 2.5/);
  });

  it('rejects low volume on the bucket lower bound', () => {
    const r = selectKeywords([
      row('example widget sizers', { min: 100, max: 1000 }),
      row('example widget sizer', { min: 1000, max: 10000 }),
      row('example gadget', { min: 880 }),
      row('example gizmo', { min: null }),
    ], { config, kd: kdMap([['example widget sizer', 5]]), competitors: [] });
    expect(r.selected.map((x) => x.keyword)).toEqual(['example widget sizer']);
    expect(Object.fromEntries(r.rejected.map((x) => [x.keyword, x.reason]))).toEqual({
      'example widget sizers': 'low-volume', 'example gadget': 'low-volume', 'example gizmo': 'low-volume',
    });
  });

  it('queues keywords without KD instead of selecting them, and rejects KD above maxKd', () => {
    const r = selectKeywords([
      row('example widget sizer'),
      row('example widget sizer app'),
      row('example gizmo sizer'),
    ], { config, kd: kdMap([['example widget sizer', 30], ['example widget sizer app', 31]]), competitors: [] });
    expect(r.selected.map((x) => [x.keyword, x.kd])).toEqual([['example widget sizer', 30]]);
    expect(r.pending.map((x) => x.keyword)).toEqual(['example gizmo sizer']);
    expect(r.rejected.map((x) => [x.keyword, x.reason])).toEqual([['example widget sizer app', 'kd']]);
  });

  it('rejects competitor brands on word boundaries, also in folded spellings', () => {
    const kd = kdMap([['widgetwiser sizer', 5], ['example widget sizer', 5]]);
    const r = selectKeywords([
      row('sizerpal widget sizer'),
      row('widget wise sizer'),
      row('widgetwise calculator'),
      row('example widget sizer', { variants: ['sizer pal widget sizer'] }),
      row('widgetwiser sizer'),
    ], { config, kd, competitors });
    expect(Object.fromEntries(r.rejected.map((x) => [x.keyword, x.reason]))).toEqual({
      'sizerpal widget sizer': 'brand', 'widget wise sizer': 'brand', 'widgetwise calculator': 'brand', 'example widget sizer': 'brand',
    });
    expect(r.selected.map((x) => x.keyword)).toEqual(['widgetwiser sizer']);
  });

  it('rejects duplicates (case and spaces ignored), keeping the higher volume', () => {
    const r = selectKeywords([row('example widget sizer', { min: 1300 }), row('Example WidgetSizer', { min: 2400 })],
      { config, kd: kdMap([['example widget sizer', 5]]), competitors: [] });
    expect(r.selected.map((x) => x.keyword)).toEqual(['Example WidgetSizer']);
    expect(r.rejected).toMatchObject([{ keyword: 'example widget sizer', reason: 'duplicate' }]);
  });

  it('puts every keyword in exactly one of selected, pending, rejected', () => {
    const rows = [row('a1 widget'), row('a2 widget', { min: 5 }), row('a3 widget', { seasonality: 9 }), row('sizerpal a4'), row('a5 widget')];
    const r = selectKeywords(rows, { config, kd: kdMap([['a1 widget', 3]]), competitors });
    const all = [...r.selected, ...r.pending, ...r.rejected].map((x) => x.keyword).sort();
    expect(all).toEqual(rows.map((x) => x.keyword).sort());
  });
});

describe('brand helpers', () => {
  it('derives the brand label from the domain', () => {
    expect(normalizeDomain('https://www.SizerPal.example/tools?x=1')).toBe('sizerpal.example');
    expect(brandLabel('tools.sizerpal.co.uk')).toBe('sizerpal');
    expect(brandLabel('widget-wise.example')).toBe('widget-wise');
    expect(normalizeDomain('not a domain')).toBeNull();
  });

  it('matches split and joined forms, not longer words', () => {
    const [brand] = brandTerms('widgetwise.example');
    expect(matchesBrand(tokenize('widget wise sizer'), brand)).toBe(true);
    expect(matchesBrand(tokenize('best widgetwise sizer'), brand)).toBe(true);
    expect(matchesBrand(tokenize('widgetwiser sizer'), brand)).toBe(false);
    expect(matchesBrand(tokenize('widget-wise.example'), brandTerms('widget-wise.example')[0])).toBe(true);
  });
});

describe('keyword-select CLI', () => {
  const exportRows = [
    { keyword: 'example widget sizer', avg: '1K – 10K' },
    { keyword: 'example gizmo sizer', avg: '1K – 10K' },
    { keyword: 'example gadget converter', avg: '2400' },
    { keyword: 'example christmas widget planner', avg: '1K – 10K', monthly: ['100 – 1K', '1K – 10K', '10K – 100K', ...flat('100 – 1K').slice(3)] },
  ];
  const files = (kd: string) => ({
    'research/inputs/kp/fake-a.example.csv': utf16Export(exportRows),
    'research/inputs/competitors.csv': 'domain,dr,notes\nfake-a.example,10,fake\n',
    'research/inputs/kd.csv': kd,
  });

  it('writes the missing-KD queue to kd-todo.csv, highest volume first', () => {
    const root = tempProject(files('keyword,kd,source,checked\nexample widget sizer,12,serp-check,2026-10-20\n'));
    expect(run('kp-ingest', root).code).toBe(0);
    const r = run('keyword-select', root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/1 selected, 2 waiting for KD, 1 rejected \(seasonal 1\)/);
    expect(readOut(root, 'kd-todo.csv')).toBe(
      'keyword,kd,source,checked,volume\nexample gadget converter,,,,2400\nexample gizmo sizer,,,,1000-10000\n');
    const out = readOutJson(root, 'selected.json');
    expect(out.selected.map((x: { keyword: string }) => x.keyword)).toEqual(['example widget sizer']);
    expect(out.pending.map((x: { keyword: string }) => x.keyword)).toEqual(['example gadget converter', 'example gizmo sizer']);
    expect(out.thresholds).toEqual({ minVolume: 1000, maxKd: 30, maxSeasonality: 2.5 });
  });

  it('--strict fails while the queue is not empty', () => {
    const root = tempProject(files('keyword,kd,source,checked\n'));
    run('kp-ingest', root);
    const r = run('keyword-select', root, ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--strict.*3 keyword\(s\) still have no KD/);
  });

  it('reads thresholds from factory.config.json', () => {
    const root = tempProject(files('keyword,kd,source,checked\nexample widget sizer,12,,\nexample gadget converter,12,,\nexample gizmo sizer,12,,\n'),
      { ...DEFAULT_RESEARCH, minVolume: 2000, maxKd: 11 });
    run('kp-ingest', root);
    expect(run('keyword-select', root).code).toBe(0);
    const out = readOutJson(root, 'selected.json');
    const reasons = Object.fromEntries(out.rejected.map((x: { keyword: string; reason: string }) => [x.keyword, x.reason]));
    expect(reasons).toEqual({
      'example widget sizer': 'low-volume', 'example gizmo sizer': 'low-volume', 'example christmas widget planner': 'low-volume',
      'example gadget converter': 'kd',
    });
  });

  it('fails on a bad kd.csv value, writing nothing', () => {
    const root = tempProject(files('keyword,kd,source,checked\nexample widget sizer,high,serp-check,2026-10-20\n'));
    const r = run('kp-ingest', root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/kd\.csv:2: kd "high" for "example widget sizer" must be a number from 0 to 100/);
    expect(existsSync(join(root, 'research', 'out', 'keywords.json'))).toBe(false);
  });

  it('fails without competitors.csv', () => {
    const root = tempProject({ 'research/inputs/kp/fake-a.example.csv': utf16Export(exportRows) });
    expect(run('kp-ingest', root).code).toBe(0);
    const r = run('keyword-select', root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/competitors\.csv is missing/);
  });
});
