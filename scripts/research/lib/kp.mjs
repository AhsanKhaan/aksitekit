// Google Keyword Planner export parsing: volumes (exact or bucketed), competition, bids, the 12 monthly columns,
// seasonality, and the merge of several competitors' exports into one keyword list.
import { RuleViolation, cleanKeyword, cmp, decodeText, keywordKey, parseDelimited } from './common.mjs';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const FULL_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december'];

const SUFFIX = { k: 1e3, m: 1e6, b: 1e9 };
const COUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*([kmb])?$/i;
// "1K – 10K": en dash in real exports; hyphen, em dash, minus sign and "to" are accepted too.
const RANGE = /^(.+?)\s*(?:–|—|‒|−|-|\bto\b)\s*(.+)$/iu;
const BLANK = /^(?:|-|--|–|n\/a)$/iu;

/** Header names (lower-cased, spaces collapsed) for the columns the pipeline reads. */
export const KP_COLUMNS = {
  keyword: ['keyword'],
  volume: ['avg. monthly searches', 'avg monthly searches', 'average monthly searches'],
  competition: ['competition'],
  competitionIndex: ['competition (indexed value)'],
  bidLow: ['top of page bid (low range)'],
  bidHigh: ['top of page bid (high range)'],
  currency: ['currency'],
};

/**
 * One count: "1300", "1,300", "1K", "1.5K", "10M". Returns null for an empty cell ("", "-", "--").
 * @throws {Error} when the cell is not a count
 */
export function parseCount(raw) {
  const s = String(raw ?? '').normalize('NFKC').trim();
  if (BLANK.test(s)) return null;
  const m = COUNT.exec(s.replace(/\s+/gu, ' '));
  if (!m) throw new Error(`"${raw}" is not a number`);
  const n = Number(`${m[1].replaceAll(',', '')}${m[2] ? `.${m[2]}` : ''}`) * (m[3] ? SUFFIX[m[3].toLowerCase()] : 1);
  return Math.round(n);
}

/**
 * A search-volume cell. Accounts without ad spend see buckets such as "1K – 10K"; those are stored as a range [R].
 * @returns {{ min: number | null, max: number | null, label: 'M' | 'R' | 'U', raw: string }}
 *   M = exact number from the export, R = bucket (min is inclusive, max exclusive), U = no data
 */
export function parseVolume(raw) {
  const text = String(raw ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const exact = (() => {
    try {
      return { ok: true, value: parseCount(text) };
    } catch {
      return { ok: false };
    }
  })();
  if (exact.ok) {
    return exact.value === null
      ? { min: null, max: null, label: 'U', raw: text }
      : { min: exact.value, max: exact.value, label: 'M', raw: text };
  }
  const r = RANGE.exec(text);
  if (r) {
    let lo;
    let hi;
    try {
      lo = parseCount(r[1]);
      hi = parseCount(r[2]);
    } catch {
      lo = null;
    }
    if (lo !== null && hi !== null && lo <= hi) return { min: lo, max: hi, label: lo === hi ? 'M' : 'R', raw: text };
  }
  throw new Error(`"${raw}" is not a search volume (expected a number such as 1300 or a range such as "1K – 10K")`);
}

/** "Searches: Jan 2025" → "2025-01"; null when the header is not a monthly column. */
export function parseMonthHeader(header) {
  const m = /^searches:\s*([a-z]+)\.?\s+(\d{4})$/i.exec(String(header).trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  let idx = MONTHS.indexOf(name);
  if (idx === -1) idx = FULL_MONTHS.indexOf(name);
  if (idx === -1) return null;
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
}

function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Value used for one month in the seasonality ratio: the number itself, or a bucket's geometric midpoint [P]. */
export function monthValue({ min, max }) {
  if (min === max) return min;
  return min > 0 ? Math.sqrt(min * max) : max / 2;
}

/**
 * Seasonality = peak month / median month over the 12 monthly columns (median of 12 = mean of the 6th and 7th values).
 * Label M when every month is an exact number, P when any month is a bucket. Null when it can't be computed.
 */
export function computeSeasonality(monthly) {
  if (monthly.length !== 12 || monthly.some((m) => m.min === null)) {
    return { seasonality: null, seasonalityLabel: 'U', peakMonth: null, seasonalityNote: 'monthly data incomplete' };
  }
  const values = monthly.map(monthValue);
  const sorted = [...values].sort((a, b) => a - b);
  const median = (sorted[5] + sorted[6]) / 2;
  const peak = sorted[11];
  const peakMonth = monthly[values.indexOf(peak)].month;
  const seasonalityLabel = monthly.every((m) => m.min === m.max) ? 'M' : 'P';
  if (peak === 0) return { seasonality: null, seasonalityLabel: 'U', peakMonth: null, seasonalityNote: 'no searches in any month' };
  if (median === 0) return { seasonality: null, seasonalityLabel: 'U', peakMonth, seasonalityNote: 'median month is 0' };
  return { seasonality: Math.round((peak / median) * 100) / 100, seasonalityLabel, peakMonth };
}

function parseCompetition(raw) {
  const s = String(raw ?? '').trim();
  if (BLANK.test(s)) return null;
  const m = /^(low|medium|high)$/i.exec(s);
  if (!m) throw new Error(`"${raw}" is not Low, Medium or High (export with the English interface)`);
  return m[1].toLowerCase();
}

function parseIndex(raw) {
  const n = parseCount(raw);
  if (n !== null && (n < 0 || n > 100)) throw new Error(`"${raw}" is outside 0–100`);
  return n;
}

function parseMoney(raw) {
  const s = String(raw ?? '').normalize('NFKC').replace(/[\s$€£¥₹]/gu, '').replace(/^[a-z]{3}|[a-z]{3}$/i, '');
  if (BLANK.test(s)) return null;
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`"${raw}" is not an amount`);
  return Number(`${m[1].replaceAll(',', '')}${m[2] ? `.${m[2]}` : ''}`);
}

const normHeader = (h) => String(h).replace(/^﻿/, '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();

/**
 * Parses one Keyword Planner export.
 * Accepts the UTF-16 LE tab-separated download (BOM, two title rows, header) and UTF-8 CSV re-saves of it
 * (comma, tab or semicolon). The header row is the first row whose first cell is "Keyword".
 * @param {Uint8Array} buffer
 * @param {{ file: string, source: string }} where file is used in messages; source names the competitor
 */
export function parseKpExport(buffer, { file, source }) {
  const { text, encoding } = decodeText(buffer);
  const lines = text.split(/\r\n|\n|\r/);
  let delimiter = null;
  for (const line of lines.slice(0, 20)) {
    const m = /^﻿?"?keyword"?([\t,;])/i.exec(line.trim());
    if (m) {
      delimiter = m[1];
      break;
    }
  }
  if (!delimiter) {
    throw new RuleViolation(`${file}: no header row starting with "Keyword" in the first 20 lines; is this a Keyword Planner export?`);
  }
  const rows = parseDelimited(text, delimiter);
  const headerIdx = rows.findIndex((r) => normHeader(r[0] ?? '') === 'keyword');
  const header = rows[headerIdx].map(normHeader);

  const col = {};
  for (const [name, aliases] of Object.entries(KP_COLUMNS)) {
    const i = header.findIndex((h) => aliases.includes(h));
    col[name] = i === -1 ? null : i;
  }
  const errors = [];
  if (col.volume === null) errors.push(`${file}: missing column "Avg. monthly searches"`);

  const monthCols = [];
  header.forEach((h, i) => {
    if (!h.startsWith('searches:')) return;
    const month = parseMonthHeader(h);
    if (!month) errors.push(`${file}: can't read the month in column "${rows[headerIdx][i].trim()}"`);
    else monthCols.push({ month, i });
  });
  monthCols.sort((a, b) => cmp(a.month, b.month));
  const months = monthCols.map((c) => c.month);
  if (new Set(months).size !== months.length) errors.push(`${file}: a "Searches: <month>" column appears twice`);
  if (monthCols.length !== 12) {
    errors.push(`${file}: found ${monthCols.length} "Searches: <Mon YYYY>" columns; exactly 12 are needed for the ` +
      'seasonality check (choose a 12-month date range in Keyword Planner before downloading)');
  } else {
    for (let k = 1; k < 12; k++) {
      if (months[k] !== nextMonth(months[k - 1])) {
        errors.push(`${file}: the 12 monthly columns are not consecutive months (${months.join(', ')})`);
        break;
      }
    }
  }
  if (errors.length) throw new RuleViolation(errors);

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const cells = rows[r];
    const keyword = cleanKeyword(cells[col.keyword] ?? '');
    if (!keyword) continue;
    const line = r + 1;
    const cell = (i) => (i === null ? '' : String(cells[i] ?? '').trim());
    const read = (fn, i, label) => {
      try {
        return fn(cell(i));
      } catch (err) {
        errors.push(`${file}:${line}: ${label} ${err.message}`);
        return null;
      }
    };
    const volume = read(parseVolume, col.volume, '"Avg. monthly searches"');
    const monthly = monthCols.map(({ month, i }) => {
      const v = read(parseVolume, i, `"Searches: ${month}"`);
      return { month, min: v?.min ?? null, max: v?.max ?? null };
    });
    out.push({
      keyword,
      volume: volume ?? { min: null, max: null, label: 'U', raw: '' },
      monthly,
      ...computeSeasonality(monthly),
      competitionAds: {
        level: read(parseCompetition, col.competition, '"Competition"'),
        index: read(parseIndex, col.competitionIndex, '"Competition (indexed value)"'),
      },
      bid: {
        low: read(parseMoney, col.bidLow, '"Top of page bid (low range)"'),
        high: read(parseMoney, col.bidHigh, '"Top of page bid (high range)"'),
        currency: cell(col.currency) || null,
      },
      source,
      file,
      line,
      lastMonth: months[11],
    });
  }
  if (errors.length) throw new RuleViolation(errors);
  if (out.length === 0) throw new RuleViolation(`${file}: the header row is there but no keyword rows follow it`);
  return {
    meta: {
      file,
      source,
      encoding,
      delimiter: delimiter === '\t' ? 'tab' : delimiter,
      rows: out.length,
      months: [months[0], months[11]],
    },
    rows: out,
  };
}

const precision = { M: 2, R: 1, U: 0 };

/**
 * Which row's metrics win when the same keyword (case- and space-insensitive) is in several exports:
 * 1. exact volume over a bucket over no data; 2. the newer 12-month window; 3. the higher volume (min, then max);
 * 4. the file name, alphabetically; 5. the earlier line.
 */
export function compareRows(a, b) {
  return (precision[b.volume.label] - precision[a.volume.label])
    || cmp(b.lastMonth, a.lastMonth)
    || ((b.volume.min ?? -1) - (a.volume.min ?? -1))
    || ((b.volume.max ?? -1) - (a.volume.max ?? -1))
    || cmp(a.file, b.file)
    || (a.line - b.line);
}

/**
 * Merges rows from every export. Keywords are deduped case- and space-insensitively; `sources[]` lists every competitor
 * export the keyword appeared in, and `variants[]` the other spellings that were folded into it.
 */
export function mergeRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = keywordKey(row.keyword);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const merged = [];
  for (const group of groups.values()) {
    group.sort(compareRows);
    const win = group[0];
    const entry = {
      keyword: win.keyword,
      volume: win.volume,
      monthly: win.monthly,
      seasonality: win.seasonality,
      seasonalityLabel: win.seasonalityLabel,
      peakMonth: win.peakMonth,
      ...(win.seasonalityNote ? { seasonalityNote: win.seasonalityNote } : {}),
      competitionAds: win.competitionAds,
      bid: win.bid,
      kd: null,
      kdSource: null,
      sources: [...new Set(group.map((r) => r.source))].sort(cmp),
      variants: [...new Set(group.map((r) => r.keyword))].filter((k) => k !== win.keyword).sort(cmp),
    };
    merged.push(entry);
  }
  return merged.sort((a, b) => cmp(a.keyword, b.keyword));
}
