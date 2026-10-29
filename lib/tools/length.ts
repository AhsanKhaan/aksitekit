/**
 * The example tool's logic (the starter's title and description length checker). It counts the way the SEO gate does
 * (scripts/audits/seo-checks.mjs: the string's length, after the browser collapses runs of spaces), against the same
 * ranges the content schema enforces (lib/content/schema.ts). Pure functions, so the page text, the worked example
 * and the tool in the browser all use the same code, and the tests check it.
 */
export type Kind = 'title' | 'description';
export const KINDS: { id: Kind; label: string; min: number; max: number }[] = [
  { id: 'title', label: 'Page title', min: 30, max: 60 },
  { id: 'description', label: 'Meta description', min: 70, max: 160 },
];

export type Result =
  | { ok: true; chars: number; words: number; fits: boolean; text: string; steps: string[] }
  | { ok: false; error: string };

/** Text as a browser shows it in a title or description: runs of spaces become one, none at either end. */
export const normalise = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function measure(kind: Kind, raw: string): Result {
  const k = KINDS.find((x) => x.id === kind) ?? KINDS[0]!;
  const text = normalise(raw);
  if (!text) return { ok: false, error: `Type or paste a ${k.label.toLowerCase()} to check it.` };
  const chars = text.length;
  const words = text.split(' ').length;
  const fits = chars >= k.min && chars <= k.max;
  const verdict = chars < k.min ? `${k.min - chars} short of the minimum` : chars > k.max ? `${chars - k.max} over the maximum` : 'inside the range';
  const advice =
    chars < k.min
      ? `Add at least ${plural(k.min - chars, 'character')}: name what the page covers or who it helps.`
      : chars > k.max
        ? `Cut at least ${plural(chars - k.max, 'character')}: drop a detail the page itself can give.`
        : `${plural(chars - k.min, 'character')} above the minimum and ${plural(k.max - chars, 'character')} below the maximum.`;
  return { ok: true, chars, words, fits, text: `${plural(chars, 'character')}, ${plural(words, 'word')}: ${verdict} (${k.min}–${k.max})`, steps: [advice] };
}
