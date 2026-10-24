// zod shapes of the files in research/out/. Downstream code (the app's content registry) can import these too.
import { z } from 'zod';

const count = z.number().int().nonnegative();

export const volumeSchema = z.object({
  min: count.nullable(),
  max: count.nullable(),
  label: z.enum(['M', 'R', 'U']),
  raw: z.string(),
});

export const keywordRowSchema = z.object({
  keyword: z.string().min(1),
  volume: volumeSchema,
  monthly: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), min: count.nullable(), max: count.nullable() })).length(12),
  seasonality: z.number().nonnegative().nullable(),
  seasonalityLabel: z.enum(['M', 'P', 'U']),
  peakMonth: z.string().nullable(),
  seasonalityNote: z.string().optional(),
  competitionAds: z.object({ level: z.enum(['low', 'medium', 'high']).nullable(), index: z.number().min(0).max(100).nullable() }),
  bid: z.object({ low: z.number().nonnegative().nullable(), high: z.number().nonnegative().nullable(), currency: z.string().nullable() }),
  kd: z.number().min(0).max(100).nullable(),
  kdSource: z.string().nullable(),
  sources: z.array(z.string()),
  variants: z.array(z.string()).default([]),
});

export const keywordsFileSchema = z.object({
  files: z.array(z.object({ file: z.string(), source: z.string() }).loose()),
  keywords: z.array(keywordRowSchema),
});

const rejectedRowSchema = keywordRowSchema.extend({
  reason: z.enum(['duplicate', 'brand', 'low-volume', 'seasonal', 'kd']),
  detail: z.string(),
}).loose();

export const selectedFileSchema = z.object({
  thresholds: z.object({ minVolume: z.number(), maxKd: z.number(), maxSeasonality: z.number() }),
  selected: z.array(keywordRowSchema.extend({ kd: z.number().min(0).max(100) }).loose()),
  pending: z.array(keywordRowSchema.loose()),
  rejected: z.array(rejectedRowSchema),
}).loose();

export const pageSchema = z.object({
  url: z.string(),
  type: z.enum(['tool', 'guide', 'hub', 'instance']),
  category: z.string(),
  primary: z.string().min(1),
  secondary: z.array(z.string()),
  intent: z.enum(['tool', 'informational', 'mixed']),
  cluster: z.string(),
  parent: z.string().nullable(),
  evidence: z.object({}).loose(),
});

export const keywordMapSchema = z.object({
  pendingKd: count,
  pages: z.array(pageSchema),
  discarded: z.array(z.object({ keyword: z.string(), reason: z.enum(['secondary-cap', 'generic']), detail: z.string() })),
});
