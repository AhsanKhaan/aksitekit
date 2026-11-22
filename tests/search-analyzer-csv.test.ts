// gsc-api-to-csv.mjs: Search Console API rows become the CSV files an export folder has (fake data only).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'search-analyzer', 'gsc-api-to-csv.mjs');
const temps: string[] = [];
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });

function run(files: Record<string, unknown>) {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-gsc-'));
  temps.push(root);
  mkdirSync(path.join(root, 'in'));
  for (const [name, data] of Object.entries(files)) writeFileSync(path.join(root, 'in', name), JSON.stringify(data));
  const r = spawnSync(process.execPath, [SCRIPT, '--in', path.join(root, 'in'), '--out', path.join(root, 'out'), '--range', 'Last 28 days'], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr, read: (f: string) => readFileSync(path.join(root, 'out', f), 'utf8') };
}

describe('gsc-api-to-csv', () => {
  test('writes export-style CSVs, recomputes CTR and quotes commas', () => {
    const r = run({ 'queries.json': { rows: [{ keys: ['a, b'], clicks: 3, impressions: 100, ctr: 0.5, position: 8.123 }] }, 'pages.json': [{ keys: ['https://example.test/x/'], clicks: 1, impressions: 10, position: 2 }] });
    expect(r.status, r.out).toBe(0);
    expect(r.read('Queries.csv')).toBe('Top queries,Clicks,Impressions,CTR,Position\n"a, b",3,100,3%,8.12\n');
    expect(r.read('Pages.csv')).toContain('https://example.test/x/,1,10,10%,2');
    expect(r.read('Filters.csv')).toContain('Date,Last 28 days');
  });

  test('a row without a key or with a bad number fails (planted)', () => {
    const r = run({ 'chart.json': [{ clicks: 1, impressions: 2 }] });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/has no date or non-numeric/);
  });

  test('no input files fails (planted)', () => {
    const r = run({});
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no input JSON found/);
  });
});
