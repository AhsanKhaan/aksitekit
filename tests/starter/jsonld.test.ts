// JSON-LD (lib/seo/jsonld.ts): the only HTML the app writes by hand, so it gets a planted script-breaking payload.
import { describe, expect, it } from 'vitest';
import { breadcrumbList, faqPage, graph, pageNode, serializeJsonLd } from '@/lib/seo/jsonld';

// A JSON escape sequence (backslash, u, four hex digits), built from code points so no tool rewrites it.
const esc = (hex: string) => `${String.fromCharCode(92)}u${hex}`;

describe('serializeJsonLd', () => {
  it('never lets a string close the script tag or open a comment (planted payload)', () => {
    const payload = '</script><script>alert(1)</script><!-- & ';
    const out = serializeJsonLd({ name: payload });
    expect(out).not.toMatch(/<|>/);
    expect(out).not.toContain('</script');
    expect(out).toContain(`${esc('003c')}/script${esc('003e')}`);
    expect(out).toContain(esc('0026'));
  });

  it('escapes the two line separators old parsers choke on', () => {
    const out = serializeJsonLd({ t: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` });
    expect(out).toBe(`{"t":"a${esc('2028')}b${esc('2029')}c"}`);
  });

  it('stays valid JSON that reads back to the same data', () => {
    const data = { a: '<b> & "c"', n: [1, 2], s: `x${String.fromCharCode(0x2028)}y` };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});

describe('graph nodes', () => {
  const base = { url: '/a/b/', h1: 'Heading', description: 'Text', updated: '2026-10-29' } as const;

  it('gives every node an @type (the SEO gate checks it)', () => {
    const g = graph(pageNode({ ...base, kind: 'guide' }), breadcrumbList([{ name: 'Home', path: '/' }]), faqPage([{ q: 'Q?', a: 'See [this](/x/).' }])) as { '@graph': Record<string, unknown>[] };
    for (const n of g['@graph']) expect(n['@type']).toBeTruthy();
  });

  it('types each page kind', () => {
    expect(pageNode({ ...base, kind: 'hub' })['@type']).toBe('CollectionPage');
    expect(pageNode({ ...base, kind: 'tool' })['@type']).toBe('WebApplication');
    expect(pageNode({ ...base, kind: 'guide' })['@type']).toBe('Article');
  });

  it('strips link markup from FAQ answers', () => {
    const f = faqPage([{ q: 'Q?', a: 'See [this page](/x/) first.' }]) as { mainEntity: { acceptedAnswer: { text: string } }[] };
    expect(f.mainEntity[0]!.acceptedAnswer.text).toBe('See this page first.');
  });
});
