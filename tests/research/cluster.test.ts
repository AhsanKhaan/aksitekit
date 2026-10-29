import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL_PATTERN, analyzeKeyword, buildMap, checkMap, singular, slugify } from '../../scripts/research/lib/cluster.mjs';
import { cleanupProjects, readOutJson, row, run, tempProject } from './helpers';

afterAll(cleanupProjects);

const kd = (keyword: string, min = 1000, extra: Parameters<typeof row>[1] = {}) => row(keyword, { min, kd: 10, ...extra });
const ownersOf = (map: { pages: { url: string; primary: string; secondary: string[] }[]; discarded: { keyword: string }[] }) => {
  const owners = new Map<string, string[]>();
  const add = (k: string, where: string) => owners.set(k, [...(owners.get(k) ?? []), where]);
  for (const p of map.pages) {
    add(p.primary, p.url);
    for (const s of p.secondary) add(s, p.url);
  }
  for (const d of map.discarded) add(d.keyword, 'discarded');
  return owners;
};

describe('normalization', () => {
  it('makes plurals singular, preferring a singular that is used elsewhere', () => {
    expect(singular('calories', new Set(['calorie']))).toBe('calorie');
    expect(singular('calories')).toBe('calory');
    expect(singular('cities')).toBe('city');
    expect(singular('inches')).toBe('inch');
    expect(singular('boxes')).toBe('box');
    expect(singular('glasses')).toBe('glass');
    expect(singular('cases')).toBe('case');
    expect(singular('feet')).toBe('foot');
    expect(singular('bus')).toBe('bus');
    expect(singular('status')).toBe('status');
    expect(singular('news')).toBe('news');
    expect(singular('lbs')).toBe('lbs');
  });

  it('ignores case, plurals, stop words and word order', () => {
    const a = analyzeKeyword('Example Widget Sizer for Kids');
    const b = analyzeKeyword('kids example widget sizers');
    const c = analyzeKeyword('the sizer of an example widget for kids');
    expect(a.topic).toEqual(['example', 'kid', 'sizer', 'widget']);
    expect(b.topic).toEqual(a.topic);
    expect(c.topic).toEqual(a.topic);
  });

  it('reads intent from modifiers', () => {
    expect(analyzeKeyword('example widget calculator')).toMatchObject({ intent: 'tool', topic: ['example', 'widget'] });
    expect(analyzeKeyword('example widget generator').topic).toEqual(['example', 'widget']);
    expect(analyzeKeyword('example gadget converter').intent).toBe('tool');
    expect(analyzeKeyword('how to size an example widget')).toMatchObject({ intent: 'informational', topic: ['example', 'how', 'size', 'widget'] });
    expect(analyzeKeyword('why example widgets wobble').intent).toBe('informational');
    expect(analyzeKeyword('example widget cost').intent).toBe('informational');
    expect(analyzeKeyword('example widget size chart').intent).toBe('informational');
    expect(analyzeKeyword('example widget cost calculator').intent).toBe('tool');
    expect(analyzeKeyword('how to use an example widget calculator').intent).toBe('informational');
    expect(analyzeKeyword('can example widgets be resized').intent).toBe('informational');
    expect(analyzeKeyword('example widgets')).toMatchObject({ intent: 'mixed', topic: ['example', 'widget'] });
    expect(analyzeKeyword('free example widget calculator online').topic).toEqual(['example', 'widget']);
    expect(analyzeKeyword('which example widget').topic).toEqual(['example', 'what', 'widget']);
  });

  it('slugifies', () => {
    expect(slugify('Example Widget Sizer (2026)')).toBe('example-widget-sizer-2026');
    expect(slugify("example widget's café size")).toBe('example-widgets-cafe-size');
  });
});

describe('buildMap', () => {
  const selected = [
    kd('example widget sizer calculator', 2400),
    kd('example widget sizer', 1000),
    kd('example widget sizers tool', 1000),
    kd('example widget sizer chart', 1300),
    kd('what is an example widget sizer', 1000),
    kd('example widgets', 10000),
    kd('how to measure an example widget', 1000),
    kd('example gadget converter', 3600),
    kd('example gadget weight converter', 1000),
    kd('example gizmo cost', 1000),
    kd('online calculator', 6600),
  ];
  const map = buildMap(selected, { cap: 10 });
  const page = (primary: string) => map.pages.find((p) => p.primary === primary);

  it('puts a guide under its parent tool, and merges a bare topic into the tool with the same topic', () => {
    expect(page('example widget sizer calculator')).toMatchObject({
      url: '/widget/example-widget-sizer-calculator/', type: 'tool', intent: 'tool', parent: null,
      // same volume: the tool-intent keyword comes first
      secondary: ['example widget sizers tool', 'example widget sizer'],
    });
    expect(page('example widget sizer chart')).toMatchObject({
      url: '/widget/example-widget-sizer-calculator/example-widget-sizer-chart/', type: 'guide', intent: 'informational',
      parent: '/widget/example-widget-sizer-calculator/', cluster: 'example-widget-sizer-calculator',
    });
    expect(page('what is an example widget sizer')?.parent).toBe('/widget/example-widget-sizer-calculator/');
  });

  it('makes a longer tool an instance of the shorter tool, and a bare topic with children a hub', () => {
    expect(page('example gadget weight converter')).toMatchObject({
      type: 'instance', parent: '/uncategorized/example-gadget-converter/',
      url: '/uncategorized/example-gadget-converter/example-gadget-weight-converter/',
    });
    expect(page('example widgets')).toMatchObject({ type: 'hub', intent: 'mixed', url: '/widget/example-widgets/' });
    expect(page('how to measure an example widget')).toMatchObject({ type: 'guide', parent: '/widget/example-widgets/' });
  });

  it('takes the category from a topic word shared by cluster heads, else uncategorized, else categories.csv', () => {
    expect(page('example widgets')?.category).toBe('widget');
    expect(page('example gizmo cost')?.category).toBe('uncategorized');
    const fixed = buildMap(selected, { cap: 10, categories: new Map([['examplegadgetconverter', { keyword: 'example gadget converter', category: 'gadgets' }]]) });
    expect(fixed.pages.filter((p) => p.cluster === 'example-gadget-converter').map((p) => p.url)).toEqual([
      '/gadgets/example-gadget-converter/', '/gadgets/example-gadget-converter/example-gadget-weight-converter/',
    ]);
  });

  it('gives every selected keyword exactly one owner (a URL or discarded[])', () => {
    const owners = ownersOf(map);
    for (const r of selected) expect(owners.get(r.keyword), r.keyword).toHaveLength(1);
    expect(owners.size).toBe(selected.length);
    expect(map.discarded).toEqual([{ keyword: 'online calculator', reason: 'generic', detail: expect.any(String) }]);
    expect(checkMap({ pendingKd: 0, ...map } as Parameters<typeof checkMap>[0], { cap: 10, selected })).toEqual([]);
    for (const p of map.pages) expect(p.url).toMatch(URL_PATTERN);
  });

  it('caps secondary keywords per page and discards the overflow (anti-stuffing)', () => {
    const variants = [
      kd('example widget sizer', 5000),
      kd('example widget sizers', 4000),
      kd('example sizer widget', 3000),
      kd('sizer for example widgets', 2000),
      kd('the example widget sizer', 1000),
    ];
    const capped = buildMap(variants, { cap: 2 });
    expect(capped.pages).toHaveLength(1);
    expect(capped.pages[0]).toMatchObject({ primary: 'example widget sizer', secondary: ['example widget sizers', 'example sizer widget'] });
    expect(capped.discarded.map((d) => [d.keyword, d.reason])).toEqual([
      ['sizer for example widgets', 'secondary-cap'],
      ['the example widget sizer', 'secondary-cap'],
    ]);
    expect(checkMap({ pendingKd: 0, ...capped } as Parameters<typeof checkMap>[0], { cap: 2, selected: variants })).toEqual([]);
    expect(buildMap(variants, { cap: 0 }).pages[0].secondary).toEqual([]);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildMap([...selected].reverse(), { cap: 10 }))).toBe(JSON.stringify(map));
  });
});

describe('checkMap (the gate)', () => {
  const base = () => ({
    pendingKd: 0,
    pages: [
      { url: '/widget/example-widget-sizer/', type: 'tool', category: 'widget', primary: 'example widget sizer', secondary: ['example widget sizers'], intent: 'tool', cluster: 'example-widget-sizer', parent: null, evidence: {} },
      { url: '/widget/example-widget-sizer/example-widget-sizer-chart/', type: 'guide', category: 'widget', primary: 'example widget sizer chart', secondary: [], intent: 'informational', cluster: 'example-widget-sizer', parent: '/widget/example-widget-sizer/', evidence: {} },
    ],
    discarded: [] as { keyword: string; reason: string; detail: string }[],
  });

  it('passes a valid map', () => {
    expect(checkMap(base(), { cap: 10 })).toEqual([]);
  });

  it('fails when two URLs share a primary keyword (cannibalization)', () => {
    const map = base();
    map.pages.push({ ...map.pages[0]!, url: '/widget/widget-sizer-2/', cluster: 'widget-sizer-2', primary: 'Example  Widget Sizer', secondary: [] });
    const v = checkMap(map, { cap: 10 });
    expect(v.some((m) => m.startsWith('cannibalization: /widget/example-widget-sizer/ and /widget/widget-sizer-2/ share the primary keyword'))).toBe(true);
  });

  it('fails on stuffing, double owners, bad URLs and missing selected keywords', () => {
    const map = base();
    map.pages[0]!.secondary = ['a', 'b', 'c', 'example widget sizer chart'];
    map.pages[1]!.url = '/Widget/x/';
    const v = checkMap(map, { cap: 3, selected: [{ keyword: 'example widget sizer' }, { keyword: 'example gizmo' }] });
    expect(v.join('\n')).toMatch(/4 secondary keywords is over maxSecondaryKeywordsPerPage 3/);
    expect(v.join('\n')).toMatch(/"example widget sizer chart" is owned twice/);
    expect(v.join('\n')).toMatch(/\/Widget\/x\/: URL must be/);
    expect(v.join('\n')).toMatch(/"example gizmo" is selected but no URL owns it/);
    expect(v.join('\n')).toMatch(/keyword "a" is not in selected\.json/);
  });
});

describe('cluster CLI', () => {
  const selectedJson = (rows: ReturnType<typeof row>[]) => JSON.stringify({
    thresholds: { minVolume: 1000, maxKd: 30, maxSeasonality: 2.5 },
    selected: rows, pending: [], rejected: [],
  });

  it('writes the map, and --check fails with a clear message on a hand-made cannibalization', () => {
    const rows = [kd('example widget sizer calculator', 2400), kd('example widget sizer chart', 1300)];
    const root = tempProject({ 'research/out/selected.json': selectedJson(rows) });
    expect(run('cluster', root).code).toBe(0);
    expect(run('cluster', root, ['--check']).code).toBe(0);

    const file = join(root, 'research', 'out', 'keyword-map.json');
    const map = readOutJson(root, 'keyword-map.json');
    map.pages[1].primary = map.pages[0].primary;
    writeFileSync(file, JSON.stringify(map));
    const r = run('cluster', root, ['--check']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/cluster: cannibalization: .* share the primary keyword "example widget sizer calculator"/);
    expect(r.stderr).toMatch(/"example widget sizer chart" is selected but no URL owns it/);
  });

  it('fails when two primaries make the same URL', () => {
    // Different topics ("café" vs "cafe"), same slug.
    const rows = [kd('example café sizer', 2400), kd('example cafe sizer', 1300)];
    const root = tempProject({
      'research/out/selected.json': selectedJson(rows),
      'research/inputs/categories.csv': 'keyword,category\nexample café sizer,widgets\nexample cafe sizer,widgets\n',
    });
    const r = run('cluster', root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/\/widgets\/example-cafe-sizer\/: two pages have this URL/);
    expect(r.stderr).toMatch(/nothing written/);
  });
});
