// Owner-written inputs: competitors.csv (brand filter), kd.csv (keyword difficulty), categories.csv (category fixes).
import { existsSync } from 'node:fs';
import { RuleViolation, cleanKeyword, cmp, keywordKey, readCsvRecords } from './common.mjs';

// Second-level labels that sit under a country code (example.co.uk → "example").
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc', 'me', 'or', 'ne', 'go']);

/** "https://www.Tools.Example.co.uk/path" → "tools.example.co.uk"; null when it isn't a host name. */
export function normalizeDomain(raw) {
  const host = String(raw ?? '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host) ? host : null;
}

/** The brand label of a domain: the label left of the public suffix ("tools.sizerpal.co.uk" → "sizerpal"). */
export function brandLabel(domain) {
  const labels = domain.split('.');
  labels.pop();
  if (labels.length >= 2 && SECOND_LEVEL.has(labels[labels.length - 1])) labels.pop();
  return labels[labels.length - 1];
}

export const tokenize = (s) => cleanKeyword(s).replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Brand terms for one competitor: the domain's brand label plus any extra names in the optional `brands` column
 * (pipe-separated, for brands that differ from the domain). Terms shorter than 3 characters are ignored.
 */
export function brandTerms(domain, extra = '') {
  const terms = [brandLabel(domain), ...String(extra).split('|')]
    .map((t) => tokenize(t))
    .filter((tokens) => tokens.join('').length >= 3);
  const seen = new Set();
  return terms.filter((t) => {
    const k = t.join(' ');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * True when the keyword names the brand, on word boundaries: the brand's words appear in a row ("widget wise"), or
 * the brand written as one word appears as a word ("widgetwise"), or neighbouring keyword words spell it
 * ("widget wise" for the brand "widgetwise"). "widgetwiser" does not match "widgetwise".
 * @param {string[]} keywordTokens
 * @param {string[]} brandTokens
 */
export function matchesBrand(keywordTokens, brandTokens) {
  const joined = brandTokens.join('');
  for (let i = 0; i < keywordTokens.length; i++) {
    if (brandTokens.every((b, j) => keywordTokens[i + j] === b)) return true;
    let run = '';
    for (let j = i; j < keywordTokens.length && run.length < joined.length; j++) {
      run += keywordTokens[j];
      if (run === joined) return true;
    }
  }
  return false;
}

/**
 * competitors.csv: `domain,dr,notes` (+ optional `brands`, pipe-separated). Required by keyword-select.
 * @returns {Promise<{ domain: string, dr: number | null, notes: string, brands: string[][] }[]>}
 */
export async function readCompetitors(file) {
  if (!existsSync(file)) {
    throw new RuleViolation('research/inputs/competitors.csv is missing (columns: domain,dr,notes); the brand filter ' +
      'needs it. See research/inputs/README.md.');
  }
  const records = await readCsvRecords(file, { required: ['domain', 'dr'], label: 'competitors.csv' });
  const errors = [];
  const seen = new Set();
  const out = [];
  for (const rec of records) {
    const domain = normalizeDomain(rec.domain);
    if (!domain) {
      errors.push(`competitors.csv:${rec.line}: "${rec.domain}" is not a domain`);
      continue;
    }
    if (seen.has(domain)) {
      errors.push(`competitors.csv:${rec.line}: ${domain} is listed twice`);
      continue;
    }
    seen.add(domain);
    let dr = null;
    if (rec.dr !== '') {
      dr = Number(rec.dr);
      if (!Number.isFinite(dr) || dr < 0 || dr > 100) {
        errors.push(`competitors.csv:${rec.line}: dr "${rec.dr}" must be a number from 0 to 100`);
        continue;
      }
    }
    out.push({ domain, dr, notes: rec.notes ?? '', brands: brandTerms(domain, rec.brands ?? '') });
  }
  if (errors.length) throw new RuleViolation(errors);
  return out.sort((a, b) => cmp(a.domain, b.domain));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * kd.csv (optional): `keyword,kd,source,checked`. A blank kd means "not checked yet". Extra columns are ignored, so the
 * filled-in kd-todo.csv can be appended as it is.
 * @returns {Promise<Map<string, { keyword: string, kd: number, source: string, checked: string | null }>>} by keywordKey
 */
export async function readKd(file, { defaultSource = 'owner' } = {}) {
  const map = new Map();
  if (!existsSync(file)) return map;
  const records = await readCsvRecords(file, { required: ['keyword', 'kd'], label: 'kd.csv' });
  const errors = [];
  for (const rec of records) {
    const keyword = cleanKeyword(rec.keyword);
    if (!keyword) {
      errors.push(`kd.csv:${rec.line}: keyword is empty`);
      continue;
    }
    if (rec.kd === '') continue;
    const kd = Number(rec.kd);
    if (!Number.isFinite(kd) || kd < 0 || kd > 100) {
      errors.push(`kd.csv:${rec.line}: kd "${rec.kd}" for "${keyword}" must be a number from 0 to 100`);
      continue;
    }
    const checked = rec.checked ? rec.checked : null;
    if (checked && (!ISO_DATE.test(checked) || Number.isNaN(Date.parse(checked)))) {
      errors.push(`kd.csv:${rec.line}: checked "${rec.checked}" must be a date as YYYY-MM-DD`);
      continue;
    }
    const key = keywordKey(keyword);
    const prev = map.get(key);
    if (prev && prev.kd !== kd) {
      errors.push(`kd.csv:${rec.line}: "${keyword}" already has kd ${prev.kd}; keep one value`);
      continue;
    }
    map.set(key, { keyword, kd, source: rec.source || defaultSource, checked });
  }
  if (errors.length) throw new RuleViolation(errors);
  return map;
}

/**
 * categories.csv (optional): `keyword,category`. Puts a cluster head (by its primary keyword) in a category; this is
 * how the owner fixes `uncategorized`.
 * @returns {Promise<Map<string, { keyword: string, category: string, line: number }>>} by keywordKey
 */
export async function readCategories(file) {
  const map = new Map();
  if (!existsSync(file)) return map;
  const records = await readCsvRecords(file, { required: ['keyword', 'category'], label: 'categories.csv' });
  const errors = [];
  for (const rec of records) {
    const keyword = cleanKeyword(rec.keyword);
    const category = rec.category.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category) || category === 'uncategorized') {
      errors.push(`categories.csv:${rec.line}: category "${rec.category}" must be a lowercase slug (a-z, 0-9, -)`);
      continue;
    }
    const key = keywordKey(keyword);
    if (map.has(key) && map.get(key).category !== category) {
      errors.push(`categories.csv:${rec.line}: "${keyword}" is given two categories`);
      continue;
    }
    map.set(key, { keyword, category, line: rec.line });
  }
  if (errors.length) throw new RuleViolation(errors);
  return map;
}
