import type { ComponentType } from 'react';
import LengthChecker from '@/components/tools/LengthChecker';

/**
 * Tool components by key: a content file's "tool" field names one. Each tool is a client component that computes in
 * the browser; the page around it is static HTML, so search engines and visitors without JavaScript still get the text.
 */
export const TOOLS: Record<string, ComponentType<{ preset?: Record<string, string | number> }>> = {
  'length-checker': LengthChecker,
};
