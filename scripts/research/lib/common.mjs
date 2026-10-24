// Shared helpers for the keyword pipeline: paths, config, text decoding, CSV, output, CLI wrapper.
// Node built-ins plus zod only (docs/CONTRACT.md: no new dependencies).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/** A broken pipeline rule. The CLI prints every message and exits 1. */
export class RuleViolation extends Error {
  /** @param {string | string[]} messages */
  constructor(messages) {
    const list = Array.isArray(messages) ? messages : [messages];
    super(list.join('\n'));
    this.name = 'RuleViolation';
    this.messages = list;
  }
}

/**
 * Project root: `--root <dir>`, else the FACTORY_ROOT env var, else the working directory.
 * FACTORY_ROOT lets `npm run research:all` run the repo's scripts against a copy of the inputs elsewhere.
 */
export function resolveRoot(argv = process.argv.slice(2), env = process.env) {
  const i = argv.indexOf('--root');
  if (i !== -1 && argv[i + 1]) return resolve(argv[i + 1]);
  if (env.FACTORY_ROOT) return resolve(env.FACTORY_ROOT);
  return process.cwd();
}

export function paths(root) {
  const inputs = join(root, 'research', 'inputs');
  const out = join(root, 'research', 'out');
  return {
    root,
    config: join(root, 'factory.config.json'),
    inputs,
    kpDir: join(inputs, 'kp'),
    competitors: join(inputs, 'competitors.csv'),
    kd: join(inputs, 'kd.csv'),
    categories: join(inputs, 'categories.csv'),
    out,
    keywords: join(out, 'keywords.json'),
    selected: join(out, 'selected.json'),
    kdTodo: join(out, 'kd-todo.csv'),
    keywordMap: join(out, 'keyword-map.json'),
  };
}

export const researchConfigSchema = z.object({
  minVolume: z.number().int().nonnegative(),
  maxKd: z.number().min(0).max(100),
  maxSeasonality: z.number().min(1),
  maxSecondaryKeywordsPerPage: z.number().int().nonnegative(),
  seedFrom: z.string().optional(),
  kdSource: z.string().optional(),
  note: z.string().optional(),
});

/** Reads `factory.config.json` and returns its validated `research` block. */
export async function loadResearchConfig(root) {
  const file = paths(root).config;
  if (!existsSync(file)) throw new RuleViolation(`factory.config.json not found in ${root}`);
  let json;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new RuleViolation(`factory.config.json is not valid JSON: ${err.message}`);
  }
  const result = researchConfigSchema.safeParse(json?.research);
  if (!result.success) {
    throw new RuleViolation(`factory.config.json → research is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Validates parsed JSON against a zod schema, or throws a RuleViolation naming the file. */
export function parseWith(schema, data, label) {
  const result = schema.safeParse(data);
  if (!result.success) throw new RuleViolation(`${label} has the wrong shape:\n${z.prettifyError(result.error)}`);
  return result.data;
}

export async function readJson(file, label, hint) {
  if (!existsSync(file)) throw new RuleViolation(`${label} not found${hint ? `: ${hint}` : ''}`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new RuleViolation(`${label} is not valid JSON: ${err.message}`);
  }
}

/** Stable output: 2-space JSON, trailing newline, no timestamps, so re-runs give identical files. */
export async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function writeText(file, text) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

/**
 * Decodes a file buffer. Keyword Planner's ".csv" download is UTF-16 LE with a BOM; Excel's "CSV UTF-8" has a UTF-8
 * BOM; other tools write plain UTF-8. Without a BOM, a buffer whose odd bytes are mostly zero is taken as UTF-16 LE.
 * @returns {{ text: string, encoding: 'utf-16le' | 'utf-16be' | 'utf-8' }}
 */
export function decodeText(buffer) {
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be' };
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8' };
  const sample = Math.min(b.length - (b.length % 2), 2000);
  if (sample >= 4) {
    let oddZeros = 0;
    for (let i = 1; i < sample; i += 2) if (b[i] === 0) oddZeros++;
    if (oddZeros / (sample / 2) > 0.6) return { text: new TextDecoder('utf-16le').decode(b), encoding: 'utf-16le' };
  }
  return { text: new TextDecoder('utf-8').decode(b), encoding: 'utf-8' };
}

/**
 * RFC 4180-style parser: quoted fields, doubled quotes, delimiters and newlines inside quotes, CRLF or LF.
 * @returns {string[][]} rows of raw cells (unquoted, not trimmed)
 */
export function parseDelimited(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const csvNeedsQuotes = /[",\r\n]/;

/** Serializes rows as UTF-8 CSV (comma, LF, quotes only where needed). */
export function toCsv(rows) {
  return rows
    .map((row) => row.map((v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return csvNeedsQuotes.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    }).join(','))
    .join('\n') + '\n';
}

/**
 * Reads a small owner-written CSV (competitors.csv, kd.csv, categories.csv) into objects keyed by lower-cased header.
 * Blank lines and lines starting with `#` are skipped. Each record carries its 1-based `line` for error messages.
 */
export async function readCsvRecords(file, { required = [], label = file } = {}) {
  const { text } = decodeText(await readFile(file));
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '' && !l.trim().startsWith('#')) ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows = parseDelimited(text, delimiter);
  let line = 0;
  let header = null;
  const records = [];
  for (const row of rows) {
    line++;
    const cells = row.map((c) => c.trim());
    if (cells.every((c) => c === '') || cells[0].startsWith('#')) continue;
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      const missing = required.filter((r) => !header.includes(r));
      if (missing.length) {
        throw new RuleViolation(`${label}: missing column(s) ${missing.join(', ')} (header is "${cells.join(',')}")`);
      }
      continue;
    }
    const rec = { line };
    header.forEach((h, i) => {
      if (h) rec[h] = cells[i] ?? '';
    });
    records.push(rec);
  }
  if (!header) throw new RuleViolation(`${label} is empty (expected a header row: ${required.join(',')})`);
  return records;
}

/** Collapses whitespace (incl. no-break and thin spaces) and lower-cases: the display form of a keyword. */
export function cleanKeyword(s) {
  return String(s).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** Case- and space-insensitive identity of a keyword: "Widget  Sizer", "widget sizer" and "widgetsizer" match. */
export function keywordKey(s) {
  return String(s).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

/** Plain code-unit string order (locale-independent, so every machine sorts the same way). */
export function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Wraps a CLI entry point: prints violations as `<name>: <message>` and sets exit code 1. */
export async function runCli(name, main) {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof RuleViolation) {
      for (const m of err.messages) console.error(`${name}: ${m}`);
      console.error(`${name}: FAILED (${err.messages.length} rule violation${err.messages.length === 1 ? '' : 's'}); nothing written.`);
    } else {
      console.error(`${name}: unexpected error`);
      console.error(err);
    }
    process.exitCode = 1;
  }
}

export function warn(name, message) {
  console.error(`${name}: warning: ${message}`);
}
