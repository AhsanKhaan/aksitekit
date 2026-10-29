// The example tool (lib/tools/length.ts) and the numbers its example pages quote.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KINDS, measure, normalise } from '@/lib/tools/length';
import { pageContentSchema } from '@/lib/content/schema';

const REPO = path.resolve(__dirname, '..', '..');
const content = (slug: string) => JSON.parse(readFileSync(path.join(REPO, 'content', 'pages', `${slug}.json`), 'utf8'));

describe('measure', () => {
  it('uses the same ranges as the content schema', () => {
    const range = (field: 'title' | 'description') => {
      const s = pageContentSchema.shape[field];
      return [s.minLength, s.maxLength];
    };
    expect(KINDS.map((k) => [k.min, k.max])).toEqual([range('title'), range('description')]);
  });

  it('counts the way a browser shows the text: runs of spaces as one, none at the ends', () => {
    expect(normalise('  a \n\t b  ')).toBe('a b');
    const r = measure('title', '  Length checker   for titles and meta descriptions ');
    expect(r).toMatchObject({ ok: true, chars: 47, words: 7, fits: true });
  });

  it('says how far a text misses, in both directions', () => {
    expect(measure('title', 'Too short')).toMatchObject({ ok: true, fits: false, text: '9 characters, 2 words: 21 short of the minimum (30–60)' });
    const long = measure('description', 'x'.repeat(161));
    expect(long).toMatchObject({ ok: true, fits: false, steps: ['Cut at least 1 character: drop a detail the page itself can give.'] });
  });

  it('accepts both ends of each range', () => {
    expect(measure('title', 'x'.repeat(30))).toMatchObject({ fits: true });
    expect(measure('title', 'x'.repeat(60))).toMatchObject({ fits: true });
    expect(measure('description', 'x'.repeat(70))).toMatchObject({ fits: true });
    expect(measure('description', 'x'.repeat(160))).toMatchObject({ fits: true });
  });

  it('asks for text instead of measuring nothing', () => {
    expect(measure('title', '   ')).toEqual({ ok: false, error: 'Type or paste a page title to check it.' });
  });
});

describe('the example pages quote what the tool computes', () => {
  it('the worked example: 78 characters cut to 70, then 50', () => {
    const page = content('handbook--length-checker--sample-title');
    const sample = String(page.toolPreset.text);
    expect(measure('title', sample)).toMatchObject({ chars: 78, words: 12, fits: false });
    expect(measure('title', sample.replace('finally ', ''))).toMatchObject({ chars: 70, words: 11 });
    expect(measure('title', 'How the starter site is planned, built and checked')).toMatchObject({ chars: 50, words: 9, fits: true });
    expect(page.answer.value).toBe('78 characters, 18 over the limit');
  });

  it('every example title and description fits the checker', () => {
    for (const slug of ['home', 'handbook', 'handbook--length-checker', 'handbook--length-checker--sample-title', 'handbook--page-anatomy', 'handbook--page-anatomy--brief-to-page']) {
      const p = content(slug);
      expect(measure('title', p.title), slug).toMatchObject({ fits: true });
      expect(measure('description', p.description), slug).toMatchObject({ fits: true });
    }
  });
});
