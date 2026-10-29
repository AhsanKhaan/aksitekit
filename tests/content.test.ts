// The content files (content/pages/*.json) and the release check.
//   npm test            : every page passes the schema, the placeholder list and the AI-writing scan, and its links
//                         go to pages that exist; the release rules run on planted pages.
//   npm run check:release (vitest --mode release): the same, plus the release rules on the real content: no
//                         template example left, and every page written from a brief that lists what it cites.
// On the template, check:release fails on purpose: its pages are examples with no briefs.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRegistry, slugOf } from '@/lib/registry';
import { PLACEHOLDER_TEXT, aiWritingScan, briefProblems, stringsOf } from '../scripts/lib/content-rules.mjs';
import { TRUST_PAGES } from '../scripts/lib/content-rules.mjs';

const REPO = path.resolve(__dirname, '..');
const RELEASE = import.meta.env.MODE === 'release';
const registry = loadRegistry(REPO);
const pages = [...registry.byUrl.values()];
const fileOf = (url: string) => path.join(REPO, 'content', 'pages', `${slugOf(url)}.json`);
const raw = (url: string) => JSON.parse(readFileSync(fileOf(url), 'utf8'));

describe('content files', () => {
  it.each(pages.map((p) => [p.url]))('%s has no placeholder text', (url) => {
    const hits = stringsOf(raw(url)).filter((t: string) => PLACEHOLDER_TEXT.test(t));
    expect(hits).toEqual([]);
  });

  it.each(pages.map((p) => [p.url]))('%s passes the AI-writing scan', (url) => {
    const scan = aiWritingScan(stringsOf(raw(url)).join('\n'));
    expect(scan.hits.map((h: { id: string; sample: string }) => `${h.id}: ${h.sample}`), `${scan.per1000.toFixed(1)} weak hits per 1,000 words`).toEqual([]);
  });

  it.each(pages.map((p) => [p.url]))('%s links only to pages that exist', (url) => {
    const targets = stringsOf(raw(url)).flatMap((t: string) => [...t.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]!));
    const known = new Set([...registry.byUrl.keys(), ...TRUST_PAGES]);
    expect(targets.filter((t: string) => !known.has(t))).toEqual([]);
  });
});

describe('the AI-writing scan (planted drafts)', () => {
  it('fails chatbot residue at once', () => {
    expect(aiWritingScan('The answer is 16. I hope this helps!').fail).toBe(true);
  });

  it('fails stock phrases once they pile up, and passes plain text', () => {
    const piled = 'In today\'s fast-paced world, this comprehensive guide will delve into a robust, seamless and pivotal topic. ' + 'Plain words follow here. '.repeat(30);
    expect(aiWritingScan(piled).fail).toBe(true);
    expect(aiWritingScan('A percent is a number out of 100. Divide by 100, then multiply. '.repeat(20)).fail).toBe(false);
  });
});

describe('the release rules (planted pages)', () => {
  const page = { url: '/a/b/', sources: [{ title: 'Standard', url: 'https://standards.example/spec' }], intro: ['See [the paper](https://papers.example/x).'] };

  it('fails a page without a brief', () => {
    expect(briefProblems(page, null, 'research/out/briefs/a--b.md')).toEqual(['/a/b/: no brief at research/out/briefs/a--b.md; every page is written from one']);
  });

  it('fails a source or outside link the brief does not list', () => {
    expect(briefProblems(page, '- Fact: X. Source: https://standards.example/spec.', 'b.md')).toEqual(['/a/b/: cites https://papers.example/x, which b.md doesn\'t list']);
    expect(briefProblems(page, 'https://standards.example/spec and https://papers.example/x', 'b.md')).toEqual([]);
  });
});

describe.runIf(RELEASE)('release: the real content', () => {
  it('has no template example left', () => {
    const examples = [path.join(REPO, 'content', 'site.json'), ...pages.map((p) => fileOf(p.url))].filter((f) => JSON.parse(readFileSync(f, 'utf8')).example === true);
    expect(examples.map((f) => path.relative(REPO, f))).toEqual([]);
  });

  it.each(pages.map((p) => [p.url]))('%s is written from a brief that lists what it cites', (url) => {
    const briefPath = `research/out/briefs/${slugOf(url)}.md`;
    const full = path.join(REPO, briefPath);
    expect(briefProblems(raw(url), existsSync(full) ? readFileSync(full, 'utf8') : null, briefPath)).toEqual([]);
  });
});
