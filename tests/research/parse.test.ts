import { describe, expect, it } from 'vitest';
import { RuleViolation, decodeText, keywordKey, parseDelimited } from '../../scripts/research/lib/common.mjs';
import {
  computeSeasonality, mergeRows, parseKpExport, parseMonthHeader, parseVolume,
} from '../../scripts/research/lib/kp.mjs';
import { KP_HEADER, flat, utf16Export, utf8Csv } from './helpers';

const months = (values: [number, number][]) => values.map(([min, max], i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, min, max }));
const exact = (values: number[]) => months(values.map((v) => [v, v]));

describe('parseVolume', () => {
  it('stores Keyword Planner buckets as ranges [R]', () => {
    expect(parseVolume('1K – 10K')).toEqual({ min: 1000, max: 10000, label: 'R', raw: '1K – 10K' });
    expect(parseVolume('100 – 1K')).toMatchObject({ min: 100, max: 1000, label: 'R' });
    expect(parseVolume('10K – 100K')).toMatchObject({ min: 10000, max: 100000, label: 'R' });
    expect(parseVolume('100K – 1M')).toMatchObject({ min: 100000, max: 1000000, label: 'R' });
    expect(parseVolume('1M – 10M')).toMatchObject({ min: 1000000, max: 10000000, label: 'R' });
    expect(parseVolume('0 – 10')).toMatchObject({ min: 0, max: 10, label: 'R' });
  });

  it('accepts other dashes, "to", and no-break spaces', () => {
    expect(parseVolume('1K-10K')).toMatchObject({ min: 1000, max: 10000, label: 'R' });
    expect(parseVolume('1K – 10K')).toMatchObject({ min: 1000, max: 10000, label: 'R' });
    expect(parseVolume('1K — 10K')).toMatchObject({ min: 1000, max: 10000 });
    expect(parseVolume('1K to 10K')).toMatchObject({ min: 1000, max: 10000 });
    expect(parseVolume('1,000 – 10,000')).toMatchObject({ min: 1000, max: 10000 });
  });

  it('stores exact numbers as [M]', () => {
    expect(parseVolume('1300')).toEqual({ min: 1300, max: 1300, label: 'M', raw: '1300' });
    expect(parseVolume('14,800')).toMatchObject({ min: 14800, max: 14800, label: 'M' });
    expect(parseVolume('1.5K')).toMatchObject({ min: 1500, label: 'M' });
  });

  it('marks empty cells unknown [U] and refuses garbage', () => {
    expect(parseVolume('')).toMatchObject({ min: null, max: null, label: 'U' });
    expect(parseVolume('--')).toMatchObject({ min: null, label: 'U' });
    expect(() => parseVolume('lots')).toThrow(/not a search volume/);
    expect(() => parseVolume('10K – 1K')).toThrow(/not a search volume/);
    expect(() => parseVolume('1,5K')).toThrow();
  });
});

describe('month headers', () => {
  it('reads "Searches: <Mon YYYY>"', () => {
    expect(parseMonthHeader('Searches: Jan 2026')).toBe('2026-01');
    expect(parseMonthHeader('searches: Dec 2025')).toBe('2025-12');
    expect(parseMonthHeader('Searches: September 2026')).toBe('2026-09');
    expect(parseMonthHeader('Searches: Foo 2026')).toBeNull();
    expect(parseMonthHeader('Avg. monthly searches')).toBeNull();
  });
});

describe('computeSeasonality (peak / median)', () => {
  it('is 1 for a flat year', () => {
    expect(computeSeasonality(exact(Array(12).fill(500)))).toMatchObject({ seasonality: 1, seasonalityLabel: 'M' });
  });

  it('uses the median of the 12 months (mean of the 6th and 7th values)', () => {
    // sorted: 210 210 260 260 320 590 | 1300 1600 2900 5400 6600 8100 → median (590 + 1300) / 2 = 945
    const r = computeSeasonality(exact([320, 260, 210, 210, 260, 590, 1300, 2900, 5400, 8100, 6600, 1600]));
    expect(r).toMatchObject({ seasonality: 8.57, seasonalityLabel: 'M', peakMonth: '2026-10' });
  });

  it('uses bucket midpoints and labels the ratio a proxy [P]', () => {
    const r = computeSeasonality(months([[100, 1000], [1000, 10000], [10000, 100000], ...Array(9).fill([100, 1000])]));
    expect(r.seasonality).toBe(100);
    expect(r.seasonalityLabel).toBe('P');
    expect(r.peakMonth).toBe('2026-03');
  });

  it('is null when it cannot be computed', () => {
    expect(computeSeasonality(exact([100, 100, 100]))).toMatchObject({ seasonality: null, seasonalityNote: 'monthly data incomplete' });
    expect(computeSeasonality(exact([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 900]))).toMatchObject({ seasonality: null, seasonalityNote: 'median month is 0' });
  });
});

describe('decodeText and parseDelimited', () => {
  it('decodes UTF-16 LE with a BOM, UTF-8 with a BOM, and plain UTF-8', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Keyword\t1K – 10K', 'utf16le')]);
    expect(decodeText(utf16)).toEqual({ text: 'Keyword\t1K – 10K', encoding: 'utf-16le' });
    expect(decodeText(Buffer.from('﻿Keyword,x', 'utf8'))).toEqual({ text: 'Keyword,x', encoding: 'utf-8' });
    expect(decodeText(Buffer.from('Keyword,x', 'utf8'))).toEqual({ text: 'Keyword,x', encoding: 'utf-8' });
  });

  it('detects UTF-16 LE without a BOM', () => {
    expect(decodeText(Buffer.from('Keyword\tAvg. monthly searches', 'utf16le')).encoding).toBe('utf-16le');
  });

  it('handles quotes, doubled quotes, delimiters and newlines inside quotes, CRLF', () => {
    const rows = parseDelimited('a,"b, c","say ""hi"""\r\n"multi\nline",2,\n', ',');
    expect(rows).toEqual([['a', 'b, c', 'say "hi"'], ['multi\nline', '2', '']]);
  });
});

describe('keywordKey', () => {
  it('ignores case and spaces', () => {
    expect(keywordKey('Example  Widget Sizer')).toBe(keywordKey('example widget sizer'));
    expect(keywordKey('examplewidget sizer')).toBe(keywordKey('example widget sizer'));
    expect(keywordKey('example widget sizer')).toBe(keywordKey('example widget sizer'));
  });
});

describe('parseKpExport', () => {
  const fakeRows = [
    { keyword: 'Example Widget Sizer', avg: '1K – 10K', competition: 'Medium', index: '41', bidLow: '0.22', bidHigh: '1,234.50' },
    { keyword: 'example gadget converter', avg: '2400', monthly: ['2400', '2400', '2900', '2400', '1900', '2400', '2400', '2400', '1900', '2400', '2400', '2900'], competition: '', index: '', bidLow: '', bidHigh: '' },
  ];

  it('reads a real-format UTF-16 LE export (BOM, tabs, two title rows)', () => {
    const buf = utf16Export(fakeRows);
    expect(buf.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    const { meta, rows } = parseKpExport(buf, { file: 'kp/fake-a.example.csv', source: 'fake-a.example' });
    expect(meta).toMatchObject({ encoding: 'utf-16le', delimiter: 'tab', rows: 2, months: ['2025-10', '2026-09'] });
    expect(rows[0]).toMatchObject({
      keyword: 'example widget sizer',
      volume: { min: 1000, max: 10000, label: 'R', raw: '1K – 10K' },
      seasonality: 1,
      seasonalityLabel: 'P',
      competitionAds: { level: 'medium', index: 41 },
      bid: { low: 0.22, high: 1234.5, currency: 'USD' },
      source: 'fake-a.example',
      line: 4,
    });
    expect(rows[0].monthly).toHaveLength(12);
    expect(rows[0].monthly[0]).toEqual({ month: '2025-10', min: 1000, max: 10000 });
    expect(rows[1]).toMatchObject({
      volume: { min: 2400, max: 2400, label: 'M' },
      seasonality: 1.21,
      seasonalityLabel: 'M',
      peakMonth: '2025-12',
      competitionAds: { level: null, index: null },
      bid: { low: null, high: null },
    });
  });

  it('reads a UTF-8 comma CSV without title rows', () => {
    const { meta, rows } = parseKpExport(Buffer.from(utf8Csv(fakeRows)), { file: 'kp/b.csv', source: 'b' });
    expect(meta).toMatchObject({ encoding: 'utf-8', delimiter: ',', rows: 2 });
    expect(rows[0].bid.high).toBe(1234.5);
  });

  it('fails without exactly 12 monthly columns', () => {
    const header = KP_HEADER.slice(0, -1);
    const buf = utf16Export([{ keyword: 'example widget sizer', avg: '1300', monthly: flat('1300').slice(0, 11) }], header);
    expect(() => parseKpExport(buf, { file: 'kp/x.csv', source: 'x' })).toThrow(/found 11 "Searches: <Mon YYYY>" columns; exactly 12/);
  });

  it('fails with file and line on a bad cell, and on a non-English competition value', () => {
    const buf = utf16Export([
      { keyword: 'example widget sizer', avg: 'lots' },
      { keyword: 'example gadget converter', avg: '1300', competition: 'Niedrig' },
    ]);
    let err: RuleViolation | undefined;
    try {
      parseKpExport(buf, { file: 'kp/x.csv', source: 'x' });
    } catch (e) {
      err = e as RuleViolation;
    }
    expect(err).toBeInstanceOf(RuleViolation);
    expect(err!.messages.some((m) => m.startsWith('kp/x.csv:4: "Avg. monthly searches"'))).toBe(true);
    expect(err!.messages.some((m) => m.includes('kp/x.csv:5: "Competition"') && m.includes('English'))).toBe(true);
  });

  it('fails when there is no Keyword header', () => {
    expect(() => parseKpExport(Buffer.from('hello,world\n1,2\n'), { file: 'kp/x.csv', source: 'x' })).toThrow(/no header row/);
  });
});

describe('mergeRows', () => {
  it('dedupes case- and space-insensitively, keeps every source, prefers exact volumes', () => {
    const a = parseKpExport(utf16Export([{ keyword: 'Example  Widget Sizer', avg: '1K – 10K' }]), { file: 'kp/a.csv', source: 'a' }).rows;
    const b = parseKpExport(Buffer.from(utf8Csv([
      { keyword: 'example widget sizer', avg: '2400' },
      { keyword: 'examplewidget sizer', avg: '170' },
    ])), { file: 'kp/b.csv', source: 'b' }).rows;
    const merged = mergeRows([...a, ...b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      keyword: 'example widget sizer',
      volume: { min: 2400, label: 'M' },
      sources: ['a', 'b'],
      variants: ['examplewidget sizer'],
      kd: null,
      kdSource: null,
    });
  });
});
