import { z } from 'zod';

/**
 * The shape of a page's content file (content/pages/<slug>.json, written by the coder from the page's brief).
 * Text strings may hold links as [words](/path/) or [words](https://…); nothing else is markup, so no content file can
 * inject HTML (components/Inline.tsx renders them as React nodes).
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
const text = z.string().trim().min(1);

export const blockSchema = z.union([
  z.strictObject({ p: text }),
  z.strictObject({ ul: z.array(text).min(1) }),
  z.strictObject({ ol: z.array(text).min(1) }),
  z.strictObject({
    // Tables need a caption and header cells (accessibility.table-headers); a repeated unit goes in the header once.
    table: z.strictObject({ caption: text, head: z.array(text).min(1), rows: z.array(z.array(z.string())).min(1) }),
  }),
  z.strictObject({ note: text }),
]);

export const sectionSchema = z.strictObject({
  heading: text.max(70),
  id: z.string().regex(/^[a-z0-9-]+$/).optional(),
  blocks: z.array(blockSchema).min(1),
});

export const sourceSchema = z.strictObject({
  title: text,
  url: z.string().regex(/^https:\/\/[^\s]+$/, 'an https URL'),
  publisher: text.optional(),
});

export const KINDS = ['home', 'category', 'tool', 'guide', 'hub', 'instance'] as const;
export type Kind = (typeof KINDS)[number];

export const pageContentSchema = z.strictObject({
  $comment: z.string().optional(),
  url: z.string().regex(/^\/(?:[a-z0-9-]+\/){0,3}$/, 'a lowercase path with a trailing slash, at most 3 levels'),
  kind: z.enum(KINDS),
  /** The template's own example pages; production-gate.mjs fails a production build while any remains. */
  example: z.boolean().optional(),
  /** A short label for navigation, lists and breadcrumbs. */
  name: text.max(40),
  title: text.min(30).max(60),
  description: text.min(70).max(160),
  h1: text.max(70),
  updated: date,
  published: date.optional(),
  intro: z.array(text).min(1),
  /** A tool's component key (components/tools/index.ts) and, for an instance, the inputs it starts with. */
  tool: z.string().regex(/^[a-z0-9-]+$/).optional(),
  toolPreset: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /** An instance's worked answer, shown above the tool. */
  answer: z.strictObject({ label: text, value: text }).optional(),
  sections: z.array(sectionSchema).default([]),
  faq: z.array(z.strictObject({ q: text, a: text })).optional(),
  sources: z.array(sourceSchema).optional(),
});
export type PageContent = z.infer<typeof pageContentSchema>;
export type Block = z.infer<typeof blockSchema>;

/** A keyword-map row (research/out/keyword-map.json, docs/CONTRACT.md). Extra fields are kept. */
export const mapRowSchema = z.looseObject({
  url: z.string(),
  type: z.enum(['tool', 'guide', 'hub', 'instance']),
  category: z.string(),
  primary: z.string(),
  secondary: z.array(z.string()).default([]),
  intent: z.string().optional(),
  cluster: z.string().optional(),
  parent: z.string().nullable().optional(),
});
export type MapRow = z.infer<typeof mapRowSchema>;
