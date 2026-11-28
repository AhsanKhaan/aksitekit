// Keyword selection: which ingested keywords become page candidates, which wait for a KD value, which are rejected.
import { cmp, keywordKey } from './common.mjs';
import { matchesBrand, tokenize } from './inputs.mjs';

/** Checked in this order; a keyword gets the first reason that applies. */
export const REJECT_REASONS = ['duplicate', 'brand', 'low-volume', 'seasonal', 'kd'];

const precision = { M: 2, R: 1, U: 0 };

/** Highest volume first (exact before bucketed at the same lower bound), then alphabetical. */
export function byVolume(a, b) {
  return ((b.volume.min ?? -1) - (a.volume.min ?? -1))
    || ((b.volume.max ?? -1) - (a.volume.max ?? -1))
    || (precision[b.volume.label] - precision[a.volume.label])
    || cmp(a.keyword, b.keyword);
}

export function volumeText(v) {
  if (v.min === null) return 'no data';
  return v.min === v.max ? String(v.min) : `${v.min}-${v.max}`;
}

/**
 * Applies the research thresholds.
 * - duplicate: the same keyword (case and spaces ignored) appears twice in keywords.json; the higher-volume row stays.
 * - brand: the keyword (or a spelling folded into it) names a competitor from competitors.csv.
 * - low-volume: the volume's lower bound is below `minVolume` (a "100 – 1K" bucket fails minVolume 1000; "1K – 10K"
 *   passes), or there is no volume at all.
 * - seasonal: peak month / median month is above `maxSeasonality`, or it can't be computed.
 * - kd: the KD from kd.csv is above `maxKd`.
 * A keyword that passes everything but has no KD yet goes to `pending` (and kd-todo.csv), not `selected`.
 *
 * @param {object[]} keywords rows from keywords.json
 * @param {{ config: { minVolume: number, maxKd: number, maxSeasonality: number },
 *   kd: Map<string, { kd: number, source: string, checked: string | null }>,
 *   competitors: { domain: string, brands: string[][] }[] }} inputs
 */
export function selectKeywords(keywords, { config, kd, competitors }) {
  const brands = competitors.flatMap((c) => c.brands.map((tokens) => ({ domain: c.domain, tokens })));
  const seen = new Map();
  const selected = [];
  const pending = [];
  const rejected = [];
  const reject = (row, reason, detail) => rejected.push({ ...row, reason, detail });

  for (const row of [...keywords].sort(byVolume)) {
    const key = keywordKey(row.keyword);
    if (seen.has(key)) {
      reject(row, 'duplicate', `same keyword as "${seen.get(key)}" (case and spaces ignored)`);
      continue;
    }
    seen.set(key, row.keyword);

    const spellings = [row.keyword, ...(row.variants ?? [])];
    const brand = brands.find((b) => spellings.some((s) => matchesBrand(tokenize(s), b.tokens)));
    if (brand) {
      reject(row, 'brand', `names competitor ${brand.domain} ("${brand.tokens.join(' ')}")`);
      continue;
    }

    const v = row.volume;
    if (v.min === null) {
      reject(row, 'low-volume', 'no search volume in the export');
      continue;
    }
    if (v.min < config.minVolume) {
      reject(row, 'low-volume', v.label === 'R'
        ? `bucket "${v.raw}" starts at ${v.min}, below minVolume ${config.minVolume}`
        : `${v.min} searches/month is below minVolume ${config.minVolume}`);
      continue;
    }

    if (row.seasonality === null) {
      reject(row, 'seasonal', `seasonality can't be computed (${row.seasonalityNote ?? 'no monthly data'}), so it ` +
        'can\'t be shown to be non-seasonal');
      continue;
    }
    if (row.seasonality > config.maxSeasonality) {
      reject(row, 'seasonal', `peak/median ${row.seasonality} is above maxSeasonality ${config.maxSeasonality} ` +
        `(peaks ${row.peakMonth})`);
      continue;
    }

    const hit = kd.get(key);
    if (!hit) {
      pending.push({ ...row, kd: null, kdSource: null });
      continue;
    }
    const withKd = { ...row, kd: hit.kd, kdSource: hit.source, kdChecked: hit.checked };
    if (hit.kd > config.maxKd) {
      reject(withKd, 'kd', `kd ${hit.kd} (${hit.source}) is above maxKd ${config.maxKd}`);
      continue;
    }
    selected.push(withKd);
  }
  return { selected, pending, rejected, brands };
}

/** kd-todo.csv: the kd.csv columns (kd left blank) plus a volume hint, highest volume first. */
export function kdTodoRows(pending) {
  return [
    ['keyword', 'kd', 'source', 'checked', 'volume'],
    ...[...pending].sort(byVolume).map((r) => [r.keyword, '', '', '', volumeText(r.volume)]),
  ];
}
