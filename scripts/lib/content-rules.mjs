// Content rules shared by the AdSense gate (scripts/adsense-gate.mjs) and the release check (tests/content.test.ts):
// word floors per page type, AdSense policy-risk terms, and the AI-writing scan. No dependencies.

/** Words in <main> (HANDBOOK §8, docs/SEO-GATE.md §5). Floors, never targets: never pad a page to reach one. */
export const FLOORS = { tool: 600, guide: 800, hub: 300, category: 300, instance: 300, home: 300, trust: 200, author: 200 };

/** The trust pages every site needs (AdSense: who runs the site, how to reach them, what data is used). */
export const TRUST_PAGES = ['/about/', '/contact/', '/privacy/', '/terms/', '/editorial-policy/'];
export const AUTHOR_PREFIX = '/authors/';

/** The page type a route is judged as: the keyword map's type, else its place in the URL scheme. */
export function pageKind(route, mapType) {
  if (route === '/') return 'home';
  if (TRUST_PAGES.includes(route)) return 'trust';
  if (route.startsWith(AUTHOR_PREFIX)) return 'author';
  if (mapType) return mapType;
  return route.split('/').filter(Boolean).length === 1 ? 'category' : 'guide';
}

/**
 * Content AdSense doesn't monetise or restricts (Google Publisher Policies, "Prohibited content" and "Restricted
 * content"). A match fails the gate unless the owner records a reviewed exception for that page and term.
 */
export const POLICY_RESTRICTED = [
  ['adult content', /\b(?:porn\w*|xxx|nude|nudity|escort services?|camgirls?|sex(?:ual)? services?)\b/i],
  ['gambling', /\b(?:casinos?|sports? betting|bookmakers?|online slots?|poker rooms?|roulette)\b/i],
  ['weapons', /\b(?:firearms?|handguns?|assault rifles?|ammunition|gun parts|3d[- ]printed guns?)\b/i],
  ['drugs', /\b(?:cocaine|heroin|methamphetamine|mdma|buy (?:weed|cannabis|marijuana)|psilocybin)\b/i],
  ['tobacco and vaping', /\b(?:cigarettes?|e-?cigarettes?|vapes?|vaping|e-liquids?)\b/i],
  ['hacking and piracy', /\b(?:keygens?|warez|cracked (?:software|apps?)|serial keys?|torrent downloads?|hack (?:an? )?accounts?)\b/i],
  ['counterfeit goods', /\b(?:replica (?:watches|bags|handbags)|counterfeit|fake (?:ids?|passports?|diplomas?))\b/i],
  ['academic dishonesty', /\b(?:buy (?:an? )?essays?|essay writing service|write my (?:essay|paper)|exam answers? for sale)\b/i],
];
/** Encouraging clicks on ads is invalid traffic (AdSense program policies). */
export const INVALID_TRAFFIC = [/\bclick (?:on )?(?:the |our |these |an? )?ads?\b/i, /\bsupport (?:us|this site) by clicking\b/i, /\bvisit our sponsors?\b/i];
/** Your-money-or-your-life topics: allowed, but the owner decides and the page carries a disclaimer and sources. */
export const YMYL = /\b(?:mortgages?|loans?|credit scores?|invest(?:ing|ments?)|retirement savings|tax returns?|medications?|dosages?|diagnos[ei]s|symptoms|pregnan\w*|lawsuits?|legal advice)\b/i;

/**
 * The AI-writing scan (check:release). The strongest patterns of vendor/skills/humanizer/SKILL.md, written as fixed
 * phrases and structures: chatbot residue (§22) and knowledge-limit hedges (§23) always count; stock phrases and the
 * overused words (§12, §13, §16, §18, docs/SEO-GATE.md §5), the "not X but Y" frame (§1) and em dashes count when
 * they pile up. A pattern list can't prove a person wrote a page; it catches the drafts nobody edited.
 */
export const AI_PATTERNS = [
  { id: 'chatbot-residue', strong: true, re: /\b(?:i hope this helps|great question|certainly!|of course!|you're absolutely right|let me know if you(?:'d| would) like|feel free to (?:ask|reach out)|as an ai\b)/gi },
  { id: 'knowledge-limit', strong: true, re: /\b(?:as of my (?:last|latest) (?:training|update)|up to my (?:last|knowledge) (?:training|cutoff)|while specific details are limited|based on (?:the )?available information|not (?:widely|publicly) (?:documented|available))\b/gi },
  { id: 'stock-phrase', re: /\b(?:in today's (?:world|fast-paced|digital)|look no further|unlock (?:the|your)|dive (?:deep|into)|deep dive|delve|seamless(?:ly)?|comprehensive guide|ever-evolving|game[- ]changer|elevate your|whether you're a)\b/gi },
  { id: 'inflated-significance', re: /\b(?:stands as a testament|a testament to|plays? a (?:key|pivotal|crucial|vital) role|pivotal moment|evolving landscape|indelible mark|setting the stage for|the future looks bright|enduring legacy)\b/gi },
  { id: 'overused-word', re: /\b(?:additionally|crucial|pivotal|meticulous(?:ly)?|intricate|intricacies|tapestry|showcas(?:e|es|ing)|underscor(?:e|es|ing)|bolstered|garner(?:ed)?|vibrant|robust|enhance(?:s|d)?|leverage[sd]?|harness(?:ing)?|realm|navigat(?:e|ing) the)\b/gi },
  { id: 'sales-language', re: /\b(?:nestled|in the heart of|breathtaking|must-visit|stunning|renowned|groundbreaking|diverse array|boasts)\b/gi },
  { id: 'copula-avoidance', re: /\b(?:serves as an?|stands as an?|functions as an?)\b/gi },
  { id: 'not-x-but-y', re: /\b(?:it's not (?:just|only|merely) [^.;!?]{1,60}[,;—] it's|not (?:just|only|merely) [^.;!?]{1,60}\bbut (?:also )?)/gi },
  { id: 'em-dash', re: /—/g },
];
/** Hits per 1,000 words at which a page fails, and the fewest words a page needs to be judged by rate. */
export const AI_FAIL_PER_1000 = 6;
const MIN_WORDS = 150;

/** { hits: [{ id, sample }], per1000, fail } for a page's visible text. */
export function aiWritingScan(text) {
  const words = (String(text).match(/[A-Z][A-Z'’-]*/gi) ?? []).length;
  const hits = [];
  for (const p of AI_PATTERNS) for (const m of String(text).matchAll(p.re)) hits.push({ id: p.id, strong: !!p.strong, sample: m[0].slice(0, 60) });
  const weak = hits.filter((h) => !h.strong).length;
  const per1000 = words ? (1000 * weak) / Math.max(words, MIN_WORDS) : 0;
  return { words, hits, per1000, fail: hits.some((h) => h.strong) || per1000 >= AI_FAIL_PER_1000 };
}

/** Every string in a content file (text, lists, tables, questions), for the scans below. */
export function stringsOf(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object') return Object.entries(value).filter(([k]) => k !== '$comment').flatMap(([, v]) => stringsOf(v));
  return [];
}

const HTTPS = /https:\/\/[^\s)\]>"'<]+/g;
const trimUrl = (u) => u.replace(/[.,;:!?]+$/, '');

/**
 * check:release (docs/TODO-step-c.md §3): a page is written from its brief, so the brief exists, and every source the
 * page cites and every outside link in its text is one the brief lists among the facts to verify. A script can't read
 * claims; it holds the page to the sources its brief was checked against.
 */
export function briefProblems(page, brief, briefPath) {
  if (brief == null) return [`${page.url}: no brief at ${briefPath}; every page is written from one`];
  const listed = new Set((String(brief).match(HTTPS) ?? []).map(trimUrl));
  const cited = [...(page.sources ?? []).map((s) => s.url), ...stringsOf(page).flatMap((t) => [...t.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1]))];
  return [...new Set(cited.map(trimUrl))].filter((u) => !listed.has(u)).map((u) => `${page.url}: cites ${u}, which ${briefPath} doesn't list`);
}

/** Placeholder text that must never reach a visitor (the same list check-repo uses on the sources). */
export const PLACEHOLDER_TEXT = /\bTODO\b|\bFIXME\b|lorem ipsum|\bcoming soon\b|\[your[ -][a-z]+\]|\{\{\w+\}\}/i;
