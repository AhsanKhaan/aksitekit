// Keyword clustering: selected keywords → one page per topic, with one primary keyword per URL.
// The rules are deterministic and documented in research/inputs/README.md ("How keywords become pages").
import { cleanKeyword, cmp, keywordKey } from './common.mjs';
import { byVolume } from './select.mjs';

/** Words that never change which page a keyword belongs to. */
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'without', 'from', 'into', 'as', 'per', 'and',
  'or', 'my', 'your', 'our', 'their', 'its', 'it', 'this', 'that', 'these', 'those', 'i', 'me', 'you', 'we', 'is', 'are',
  'was', 'be', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
]);
/** Dropped from the topic and ignored for intent: "free widget calculator" = "widget calculator online". */
export const NEUTRAL_MODIFIERS = new Set(['free', 'online']);
/** Mark a tool page. Dropped from the topic, so "widget calculator" and "widget tool" are one page. */
export const TOOL_MODIFIERS = new Set([
  'tool', 'calculator', 'calc', 'generator', 'converter', 'convert', 'conversion', 'checker', 'estimator', 'maker',
  'solver',
]);
/** Question words mark a guide and beat tool modifiers ("how to use a widget calculator" is a guide). Kept in the topic. */
export const QUESTION_WORDS = new Map([
  ['how', 'how'], ['what', 'what'], ['which', 'what'], ['why', 'why'], ['when', 'when'], ['where', 'where'], ['who', 'who'],
]);
/** A keyword whose first word is one of these is a question too ("can widgets be resized"). */
export const QUESTION_STARTERS = new Set(['can', 'do', 'does', 'is', 'are', 'should', 'will', 'could', 'would']);
/** Mark a guide unless a tool modifier is present ("widget cost" is a guide, "widget cost calculator" a tool). Kept in the topic. */
export const GUIDE_MODIFIERS = new Map([
  ['cost', 'cost'], ['price', 'price'], ['chart', 'chart'], ['guide', 'guide'], ['formula', 'formula'], ['table', 'table'],
  ['meaning', 'meaning'], ['definition', 'definition'], ['vs', 'vs'], ['versus', 'vs'], ['tutorial', 'tutorial'],
  ['explained', 'explained'], ['difference', 'difference'],
]);

const IRREGULAR = new Map([
  ['children', 'child'], ['people', 'person'], ['men', 'man'], ['women', 'woman'], ['feet', 'foot'], ['teeth', 'tooth'],
  ['mice', 'mouse'], ['geese', 'goose'], ['knives', 'knife'], ['lives', 'life'], ['leaves', 'leaf'], ['halves', 'half'],
  ['shelves', 'shelf'], ['wolves', 'wolf'],
]);
const UNINFLECTED = new Set(['news', 'series', 'species', 'lens', 'means', 'yes', 'this', 'its']);

/**
 * Plural → singular, checked against the words actually present: "calories" becomes "calorie" when "calorie" is used
 * somewhere, otherwise the default rule applies (ies→y, sses/xes/zes/ches/shes→drop "es", else drop "s").
 * Words of 3 letters or fewer, words with digits, and words ending in ss/us/is are left alone.
 */
export function singular(word, vocab = new Set()) {
  if (IRREGULAR.has(word)) return IRREGULAR.get(word);
  if (word.length <= 3 || /\d/.test(word) || UNINFLECTED.has(word) || !word.endsWith('s') || /(?:ss|us|is)$/.test(word)) {
    return word;
  }
  let candidates;
  let fallback;
  if (word.endsWith('ies') && word.length > 4) {
    candidates = [`${word.slice(0, -3)}y`, word.slice(0, -1)];
    fallback = candidates[0];
  } else if (word.endsWith('es')) {
    candidates = [word.slice(0, -2), word.slice(0, -1)];
    fallback = /(?:sses|xes|zes|ches|shes)$/.test(word) ? candidates[0] : candidates[1];
  } else {
    candidates = [word.slice(0, -1)];
    fallback = candidates[0];
  }
  return candidates.find((c) => vocab.has(c)) ?? fallback;
}

/** Lower-case words with apostrophes removed and every other non-letter/digit as a separator ("widget's" → "widgets"). */
export function rawTokens(keyword) {
  return cleanKeyword(keyword).replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Normalizes one keyword: case, plurals (vocabulary-aware), stop words, word order (the topic is a sorted set).
 * @returns {{ intent: 'tool' | 'informational' | 'mixed', topic: string[], rule: string, pairs: [string, string][] }}
 *   topic = the sorted, de-duplicated words that decide the page; pairs = [raw word, normalized word]
 */
export function analyzeKeyword(keyword, vocab = new Set()) {
  const raw = rawTokens(keyword);
  const pairs = raw.map((w) => [w, singular(w, vocab)]);
  const content = pairs.map(([, n]) => n).filter((n) => !STOP_WORDS.has(n));
  const question = content.find((t) => QUESTION_WORDS.has(t));
  const starter = QUESTION_STARTERS.has(raw[0]) && raw.length > 1 ? raw[0] : null;
  const tool = content.find((t) => TOOL_MODIFIERS.has(t));
  const guide = content.find((t) => GUIDE_MODIFIERS.has(t));
  let intent;
  let rule;
  if (question || starter) {
    intent = 'informational';
    rule = question ? `question word "${question}"` : `starts with "${starter}" (a question)`;
  } else if (tool) {
    intent = 'tool';
    rule = `tool modifier "${tool}"`;
  } else if (guide) {
    intent = 'informational';
    rule = `guide modifier "${guide}"`;
  } else {
    intent = 'mixed';
    rule = 'no intent modifier';
  }
  const topic = [...new Set(content
    .filter((t) => !TOOL_MODIFIERS.has(t) && !NEUTRAL_MODIFIERS.has(t))
    .map((t) => QUESTION_WORDS.get(t) ?? GUIDE_MODIFIERS.get(t) ?? t))].sort(cmp);
  return { intent, topic, rule, pairs };
}

/** "Example Widget Sizer (2026)" → "example-widget-sizer-2026". */
export function slugify(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const precision = { M: 2, R: 1, U: 0 };

/**
 * Primary choice inside a group: highest volume (lower bound, then upper, exact first), then a keyword whose own intent
 * is the page's ("widget cost calculator" over "widget cost" on a tool page), then shorter, then alphabetical.
 */
export function byPrimary(a, b, intent) {
  return ((b.row.volume.min ?? -1) - (a.row.volume.min ?? -1))
    || ((b.row.volume.max ?? -1) - (a.row.volume.max ?? -1))
    || (precision[b.row.volume.label] - precision[a.row.volume.label])
    || ((a.analysis.intent === intent ? 0 : 1) - (b.analysis.intent === intent ? 0 : 1))
    || (a.row.keyword.length - b.row.keyword.length)
    || cmp(a.row.keyword, b.row.keyword);
}

const isSubset = (small, big) => small.every((t) => big.includes(t));
const isStrictSubset = (small, big) => small.length < big.length && isSubset(small, big);

export const UNCATEGORIZED = 'uncategorized';
export const URL_PATTERN = /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?$/;
export const PAGE_TYPES = ['tool', 'guide', 'hub', 'instance'];
export const INTENTS = ['tool', 'informational', 'mixed'];

/**
 * Builds the keyword map from selected keywords.
 *
 * 1. Each keyword is analyzed (analyzeKeyword): intent from modifiers, topic = normalized word set.
 * 2. Keywords with the same intent and topic form one group. A mixed or informational group whose topic equals a tool
 *    group's topic joins the tool group ("widget sizer" joins "widget sizer calculator"; "widget cost" joins
 *    "widget cost calculator"). A keyword with an empty topic ("online calculator") is discarded: `generic`.
 * 3. Primary = the group's highest-volume keyword (byPrimary breaks ties); the rest are secondary, capped at
 *    maxSecondaryKeywordsPerPage (the overflow is discarded: `secondary-cap`).
 * 4. Parents (at most one level, so URLs stay ≤ 3 deep):
 *    - a tool whose topic strictly contains a top-level tool's topic is an `instance` under it;
 *    - an informational or mixed group whose topic strictly contains a top-level tool's topic is a `guide` under it;
 *      failing that, under a top-level mixed group whose topic it strictly contains (which becomes a `hub`);
 *    - the most specific parent wins (largest topic), then the higher volume, then alphabetical.
 *    Top-level informational groups are guides; top-level mixed groups are hubs when they have children, else guides.
 * 5. Category per cluster head (top-level page): the head's topic word shared with the most other heads (at least 2
 *    heads; words in every head are skipped when there are 3 or more heads; ties: more volume, then alphabetical),
 *    written as it appears in the keywords; categories.csv overrides it; with no shared word: `uncategorized`.
 * 6. URLs: /{category}/{slug}/ for heads, /{category}/{parent-slug}/{slug}/ for children; slug = slugify(primary).
 *
 * @param {object[]} selected rows from selected.json → selected
 * @param {{ cap: number, categories?: Map<string, { category: string }> }} options
 */
export function buildMap(selected, { cap, categories = new Map() }) {
  const warnings = [];
  const discarded = [];
  const vocab = new Set(selected.flatMap((r) => rawTokens(r.keyword)));

  const groups = new Map();
  for (const row of [...selected].sort(byVolume)) {
    const a = analyzeKeyword(row.keyword, vocab);
    if (a.topic.length === 0) {
      discarded.push({ keyword: row.keyword, reason: 'generic', detail: 'only modifiers and stop words; no topic to build a page on' });
      continue;
    }
    const id = `${a.intent}|${a.topic.join(' ')}`;
    if (!groups.has(id)) groups.set(id, { intent: a.intent, topic: a.topic, members: [] });
    groups.get(id).members.push({ row, analysis: a });
  }
  // Same topic as a tool → same page as the tool.
  for (const g of groups.values()) {
    if (g.intent !== 'tool') continue;
    for (const intent of ['mixed', 'informational']) {
      const id = `${intent}|${g.topic.join(' ')}`;
      if (groups.has(id)) {
        g.members.push(...groups.get(id).members);
        groups.delete(id);
      }
    }
  }

  const pages = [...groups.values()].map((g) => {
    g.members.sort((x, y) => byPrimary(x, y, g.intent));
    const [first, ...rest] = g.members;
    const decider = g.members.find((m) => m.analysis.intent === g.intent);
    const merged = g.members.filter((m) => m.analysis.intent !== g.intent).length;
    for (const m of rest.slice(cap)) {
      discarded.push({
        keyword: m.row.keyword,
        reason: 'secondary-cap',
        detail: `"${first.row.keyword}" already has ${cap} secondary keywords (maxSecondaryKeywordsPerPage)`,
      });
    }
    return {
      intent: g.intent,
      topic: g.topic,
      primary: first.row,
      analysis: first.analysis,
      members: g.members,
      secondary: rest.slice(0, cap).map((m) => m.row.keyword),
      parent: null,
      children: [],
      type: null,
      rules: [
        `intent: ${g.intent} ("${decider.row.keyword}": ${decider.analysis.rule})`,
        ...(merged ? [`merged: ${merged} keyword(s) without a tool modifier but with the same topic words`] : []),
      ],
    };
  });
  const order = (x, y) => (x.topic.length - y.topic.length) || byVolume(x.primary, y.primary);
  const bestParent = (candidates) => [...candidates]
    .sort((x, y) => (y.topic.length - x.topic.length) || byVolume(x.primary, y.primary))[0];
  const attach = (child, parent, type) => {
    child.parent = parent;
    child.type = type;
    parent.children.push(child);
    child.rules.push(`parent: "${parent.primary.keyword}" (its topic words ${parent.topic.join(', ')} are all in this one)`);
  };

  const tools = pages.filter((p) => p.intent === 'tool').sort(order);
  const topTools = [];
  for (const t of tools) {
    const parent = bestParent(topTools.filter((p) => isStrictSubset(p.topic, t.topic)));
    if (parent) attach(t, parent, 'instance');
    else {
      t.type = 'tool';
      topTools.push(t);
    }
  }
  const topMixed = [];
  for (const m of pages.filter((p) => p.intent === 'mixed').sort(order)) {
    const tool = bestParent(topTools.filter((p) => isStrictSubset(p.topic, m.topic)));
    const hub = tool ? null : bestParent(topMixed.filter((p) => isStrictSubset(p.topic, m.topic)));
    if (tool || hub) attach(m, tool ?? hub, 'guide');
    else topMixed.push(m);
  }
  for (const g of pages.filter((p) => p.intent === 'informational').sort(order)) {
    const tool = bestParent(topTools.filter((p) => isStrictSubset(p.topic, g.topic)));
    const hub = tool ? null : bestParent(topMixed.filter((p) => isStrictSubset(p.topic, g.topic)));
    if (tool || hub) attach(g, tool ?? hub, 'guide');
    else g.type = 'guide';
  }
  for (const m of topMixed) {
    m.type = m.children.length ? 'hub' : 'guide';
    m.rules.push(m.children.length ? `hub: ${m.children.length} page(s) sit under it` : 'guide: mixed intent and nothing sits under it');
  }

  // Categories per cluster head.
  const heads = pages.filter((p) => !p.parent);
  const candidateWords = (p) => p.topic.filter((t) => !/^\d+$/.test(t) && ![...QUESTION_WORDS.values()].includes(t)
    && ![...GUIDE_MODIFIERS.values()].includes(t));
  const share = new Map();
  for (const h of heads) {
    for (const w of candidateWords(h)) {
      const s = share.get(w) ?? { heads: 0, volume: 0 };
      s.heads++;
      s.volume += h.primary.volume.min ?? 0;
      share.set(w, s);
    }
  }
  const usedOverrides = new Set();
  for (const h of heads) {
    const override = categories.get(keywordKey(h.primary.keyword));
    if (override) {
      usedOverrides.add(keywordKey(h.primary.keyword));
      h.category = override.category;
      h.rules.push(`category: "${override.category}" from categories.csv`);
      continue;
    }
    const word = candidateWords(h)
      .filter((w) => share.get(w).heads >= 2 && !(heads.length >= 3 && share.get(w).heads === heads.length))
      .sort((x, y) => (share.get(y).heads - share.get(x).heads) || (share.get(y).volume - share.get(x).volume) || cmp(x, y))[0];
    if (!word) {
      h.category = UNCATEGORIZED;
      h.rules.push('category: no topic word shared with another cluster head; set one in categories.csv');
      continue;
    }
    const forms = new Map();
    for (const other of heads) {
      for (const [rawWord, norm] of other.analysis.pairs) if (norm === word) forms.set(rawWord, (forms.get(rawWord) ?? 0) + 1);
    }
    const surface = [...forms.entries()].sort((x, y) => (y[1] - x[1]) || (x[0].length - y[0].length) || cmp(x[0], y[0]))[0][0];
    h.category = slugify(surface);
    h.rules.push(`category: "${word}" is shared by ${share.get(word).heads} cluster heads`);
  }
  for (const [key, o] of categories) {
    if (!usedOverrides.has(key)) warnings.push(`categories.csv: "${o.keyword}" is not a cluster head's primary keyword; ignored`);
  }

  const out = [];
  const emit = (p, parentUrl, head) => {
    const slug = slugify(p.primary.keyword);
    p.url = parentUrl ? `${parentUrl}${slug}/` : `/${head.category}/${slug}/`;
    out.push({
      url: p.url,
      type: p.type,
      category: head.category,
      primary: p.primary.keyword,
      secondary: p.secondary,
      intent: p.intent,
      cluster: slugify(head.primary.keyword),
      parent: parentUrl,
      evidence: {
        rules: p.rules,
        topic: p.topic,
        volume: p.primary.volume,
        kd: p.primary.kd,
        kdSource: p.primary.kdSource,
        seasonality: p.primary.seasonality,
        seasonalityLabel: p.primary.seasonalityLabel,
        peakMonth: p.primary.peakMonth,
        competitionAds: p.primary.competitionAds,
        sources: [...new Set(p.members.flatMap((m) => m.row.sources ?? []))].sort(cmp),
      },
    });
    for (const c of p.children) emit(c, p.url, head);
  };
  for (const h of heads) emit(h, null, h);

  return {
    pages: out.sort((x, y) => cmp(x.url, y.url)),
    discarded: discarded.sort((x, y) => cmp(x.keyword, y.keyword)),
    warnings,
  };
}

/**
 * The gate. Returns every rule the map breaks (an empty list means it passes):
 * URL shape and depth, unique URLs, one primary per URL (cannibalization), each keyword owned once, the secondary cap,
 * parent links, and — given the selected keywords — that every selected keyword is owned by a URL or discarded.
 * @param {{ pages: object[], discarded: object[] }} map
 * @param {{ cap: number, selected?: { keyword: string }[] }} options
 */
export function checkMap(map, { cap, selected }) {
  const v = [];
  const byUrl = new Map();
  for (const p of map.pages) {
    if (!URL_PATTERN.test(p.url)) v.push(`${p.url}: URL must be /{category}/{slug}/ or /{category}/{slug}/{child}/ (lowercase a-z, 0-9, -)`);
    if (byUrl.has(p.url)) v.push(`${p.url}: two pages have this URL`);
    byUrl.set(p.url, p);
    if (!PAGE_TYPES.includes(p.type)) v.push(`${p.url}: type "${p.type}" is not one of ${PAGE_TYPES.join(', ')}`);
    if (!INTENTS.includes(p.intent)) v.push(`${p.url}: intent "${p.intent}" is not one of ${INTENTS.join(', ')}`);
    if (p.url.split('/')[1] !== p.category) v.push(`${p.url}: category "${p.category}" does not match the URL`);
    if (p.secondary.length > cap) {
      v.push(`${p.url}: ${p.secondary.length} secondary keywords is over maxSecondaryKeywordsPerPage ${cap} (keyword stuffing)`);
    }
  }
  const primaries = new Map();
  for (const p of map.pages) {
    const key = keywordKey(p.primary);
    if (primaries.has(key)) {
      v.push(`cannibalization: ${primaries.get(key)} and ${p.url} share the primary keyword "${p.primary}"`);
    } else {
      primaries.set(key, p.url);
    }
  }
  const owner = new Map();
  const own = (keyword, where) => {
    const key = keywordKey(keyword);
    if (owner.has(key)) v.push(`"${keyword}" is owned twice: ${owner.get(key).where} and ${where}`);
    else owner.set(key, { keyword, where });
  };
  for (const p of map.pages) {
    own(p.primary, `${p.url} (primary)`);
    for (const s of p.secondary) own(s, `${p.url} (secondary)`);
  }
  for (const d of map.discarded) own(d.keyword, `discarded (${d.reason})`);
  for (const p of map.pages) {
    const depth = p.url.split('/').length - 2;
    if (depth === 3) {
      const parent = byUrl.get(p.parent);
      if (!parent || !p.url.startsWith(p.parent)) v.push(`${p.url}: parent ${p.parent} is not a page above it`);
      else if (parent.parent) v.push(`${p.url}: parent ${p.parent} is itself a child (URLs are at most 3 levels deep)`);
      else if (p.type === 'instance' && parent.type !== 'tool') v.push(`${p.url}: an instance must sit under a tool`);
      else if (p.type === 'guide' && !['tool', 'hub'].includes(parent.type)) v.push(`${p.url}: a guide sits under a tool or a hub`);
      else if (!['guide', 'instance'].includes(p.type)) v.push(`${p.url}: a ${p.type} page can't be a child page`);
    } else if (p.parent) {
      v.push(`${p.url}: a top-level page has parent ${p.parent}`);
    } else if (p.type === 'instance') {
      v.push(`${p.url}: an instance must sit under a tool`);
    }
  }
  const clusters = new Map();
  for (const p of map.pages) {
    if (p.parent) {
      const parent = byUrl.get(p.parent);
      if (parent && parent.cluster !== p.cluster) v.push(`${p.url}: cluster "${p.cluster}" differs from its parent's "${parent.cluster}"`);
    } else if (clusters.has(p.cluster)) {
      v.push(`cluster "${p.cluster}" is used by two top-level pages: ${clusters.get(p.cluster)} and ${p.url}`);
    } else {
      clusters.set(p.cluster, p.url);
    }
  }
  if (selected) {
    const wanted = new Set(selected.map((r) => keywordKey(r.keyword)));
    for (const r of selected) {
      if (!owner.has(keywordKey(r.keyword))) v.push(`"${r.keyword}" is selected but no URL owns it and it is not discarded`);
    }
    for (const [key, { keyword, where }] of owner) {
      if (!wanted.has(key)) v.push(`${where}: keyword "${keyword}" is not in selected.json`);
    }
  }
  return v;
}
