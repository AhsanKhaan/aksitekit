// Test helpers for the keyword pipeline: fake Keyword Planner exports and throwaway project folders.
// Every fixture here is fake data generated in the test.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../..', import.meta.url));

export const MONTHS = ['Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026',
  'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026'];

export const KP_HEADER = ['Keyword', 'Currency', 'Avg. monthly searches', 'Three month change', 'YoY change', 'Competition',
  'Competition (indexed value)', 'Top of page bid (low range)', 'Top of page bid (high range)', 'Ad impression share',
  'Organic impression share', 'Organic average position', 'In account?', 'In plan?', ...MONTHS.map((m) => `Searches: ${m}`)];

export interface FakeRow {
  keyword: string;
  avg: string;
  monthly?: string[];
  competition?: string;
  index?: string;
  bidLow?: string;
  bidHigh?: string;
}

export const flat = (v: string) => Array<string>(12).fill(v);

export function kpCells(r: FakeRow): string[] {
  return [r.keyword, 'USD', r.avg, '0%', '0%', r.competition ?? 'Low', r.index ?? '10', r.bidLow ?? '0.10',
    r.bidHigh ?? '0.40', '', '', '', 'N', 'N', ...(r.monthly ?? flat(r.avg))];
}

/** Keyword Planner's real download: UTF-16 LE with BOM, tab-separated, CRLF, two title rows, then the header. */
export function utf16Export(rows: FakeRow[], header: string[] = KP_HEADER): Buffer {
  const text = [
    ['Keyword Stats 2026-10-25 at 09_00_00'],
    ['October 1, 2025 - September 30, 2026'],
    header,
    ...rows.map(kpCells),
  ].map((r) => r.join('\t')).join('\r\n') + '\r\n';
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

/** A UTF-8 comma-separated re-save, no title rows. */
export function utf8Csv(rows: FakeRow[], header: string[] = KP_HEADER): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  return [header, ...rows.map(kpCells)].map((r) => r.map(q).join(',')).join('\n') + '\n';
}

export const DEFAULT_RESEARCH = {
  seedFrom: 'lowest-dr-competitor',
  minVolume: 1000,
  maxKd: 30,
  maxSeasonality: 2.5,
  maxSecondaryKeywordsPerPage: 10,
  kdSource: 'serp-check',
};

const made: string[] = [];

/** A throwaway project: factory.config.json (the repo's, with `research` overrides) plus the given files. */
export function tempProject(files: Record<string, string | Buffer>, research: Partial<typeof DEFAULT_RESEARCH> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'factory-research-'));
  made.push(root);
  const config = JSON.parse(readFileSync(join(REPO, 'factory.config.json'), 'utf8'));
  config.research = { ...config.research, ...research };
  writeFileSync(join(root, 'factory.config.json'), JSON.stringify(config, null, 2));
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

export function cleanupProjects() {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
}

export interface RunResult { code: number | null; stdout: string; stderr: string }

/** Runs one pipeline script the way `npm run research:*` does, against `root`. */
export function run(script: 'kp-ingest' | 'keyword-select' | 'cluster', root: string, args: string[] = []): RunResult {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'research', `${script}.mjs`), ...args], {
    cwd: REPO,
    env: { ...process.env, FACTORY_ROOT: root },
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export const readOut = (root: string, name: string) => readFileSync(join(root, 'research', 'out', name), 'utf8');
export const readOutJson = (root: string, name: string) => JSON.parse(readOut(root, name));

/** A keywords.json row, for unit tests of selection and clustering. */
export function row(keyword: string, opts: {
  min?: number | null; max?: number | null; label?: 'M' | 'R' | 'U'; seasonality?: number | null; kd?: number | null;
  variants?: string[]; sources?: string[];
} = {}) {
  const min = opts.min === undefined ? 1000 : opts.min;
  const max = opts.max === undefined ? min : opts.max;
  const label = opts.label ?? (min === null ? 'U' : min === max ? 'M' : 'R');
  return {
    keyword,
    volume: { min, max, label, raw: min === max ? String(min) : `${min} – ${max}` },
    monthly: MONTHS.map((_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, min, max })),
    seasonality: opts.seasonality === undefined ? 1 : opts.seasonality,
    seasonalityLabel: 'M',
    peakMonth: '2026-01',
    competitionAds: { level: 'low', index: 10 },
    bid: { low: 0.1, high: 0.4, currency: 'USD' },
    kd: opts.kd ?? null,
    kdSource: opts.kd === undefined || opts.kd === null ? null : 'serp-check',
    sources: opts.sources ?? ['fake-a.example'],
    variants: opts.variants ?? [],
  };
}
