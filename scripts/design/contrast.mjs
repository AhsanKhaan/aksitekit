// The design gate (`npm run gate:design`, docs/TODO-step-c.md §3): WCAG 2.2 AA contrast from the tokens in
// docs/DESIGN.md (the google-labs-code/design.md format). Every component that names a textColor and a
// backgroundColor is a pair: text needs 4.5:1, large text (24 px, or 18.66 px bold, and up) 3:1, and UI boundaries
// (a component whose name says border, divider, outline or focus) 3:1 (WCAG 1.4.3 and 1.4.11). No dependencies: the
// front matter is read with a small YAML subset (nested maps, scalars, quoted strings), which is all the format uses.
//
//   node scripts/design/contrast.mjs [docs/DESIGN.md]
import { existsSync, readFileSync } from 'node:fs';
import { isMain } from '../lib/site.mjs';

/** The YAML subset DESIGN.md front matter uses: nested maps by indentation, scalar values, # comments. */
export function parseYamlSubset(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const m = raw.trim().match(/^("[^"]+"|'[^']+'|[^:]*[^:\s])\s*:\s*((?:\S.*)?)$/);
    if (!m) throw new Error(`can't read the front-matter line "${raw.trim()}"`);
    const key = m[1].replace(/^["']|["']$/g, '');
    let value = m[2].replace(/\s+#.*$/, '').trim();
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).obj;
    if (value === '') {
      parent[key] = {};
      stack.push({ indent, obj: parent[key] });
    } else {
      if (/^".*"$|^'.*'$/.test(value)) value = value.slice(1, -1);
      parent[key] = value;
    }
  }
  return root;
}

/** The design tokens in DESIGN.md's front matter. @param {string} md @returns {Record<string, any>} */
export function frontMatter(md) {
  const m = String(md).replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('DESIGN.md must start with YAML front matter between --- lines');
  return parseYamlSubset(m[1]);
}

/** "{colors.primary}" → the token's value (references may chain). */
export function resolveRef(tokens, value, seen = new Set()) {
  const m = String(value ?? '').match(/^\{([a-z0-9-]+(?:\.[a-z0-9-]+)+)\}$/i);
  if (!m) return value;
  if (seen.has(m[1])) throw new Error(`token reference loop at {${m[1]}}`);
  seen.add(m[1]);
  const v = m[1].split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tokens);
  if (v === undefined) throw new Error(`{${m[1]}} doesn't name a token`);
  return resolveRef(tokens, v, seen);
}

export function parseColor(value) {
  const v = String(value).trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = v.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (m) return m.slice(1, 4).map(Number);
  throw new Error(`"${value}" is not a #rgb, #rrggbb or rgb() colour (transparent colours can't be checked)`);
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
/** WCAG contrast ratio, 1 to 21. */
export function contrast(a, b) {
  const [l1, l2] = [luminance(parseColor(a)), luminance(parseColor(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const px = (size) => {
  const m = String(size ?? '').match(/^([\d.]+)(px|rem|em)?$/);
  if (!m) return 16;
  return m[2] === 'rem' || m[2] === 'em' ? Number(m[1]) * 16 : Number(m[1]);
};

/** The pairs to check and their results. */
export function checkDesign(/** @type {Record<string, any>} */ tokens) {
  const results = [];
  const problems = [];
  const components = tokens.components ?? {};
  if (!Object.keys(components).length) problems.push('DESIGN.md front matter has no components with textColor and backgroundColor to check');
  for (const [name, c] of Object.entries(components)) {
    if (!c || typeof c !== 'object' || !c.textColor || !c.backgroundColor) continue;
    let fg;
    let bg;
    try {
      fg = resolveRef(tokens, c.textColor);
      bg = resolveRef(tokens, c.backgroundColor);
      parseColor(fg);
      parseColor(bg);
    } catch (e) {
      problems.push(`components.${name}: ${e.message}`);
      continue;
    }
    const type = c.typography ? resolveRef(tokens, c.typography) : null;
    const size = px(typeof type === 'object' ? type?.fontSize : undefined);
    const bold = Number(typeof type === 'object' ? type?.fontWeight : 400) >= 700;
    const ui = /border|divider|outline|focus|ring/i.test(name);
    const large = size >= 24 || (bold && size >= 18.66);
    const need = ui || large ? 3 : 4.5;
    const ratio = contrast(fg, bg);
    const row = { name, fg, bg, ratio: Math.round(ratio * 100) / 100, need, kind: ui ? 'UI boundary' : large ? 'large text' : 'text' };
    results.push(row);
    if (ratio < need) problems.push(`components.${name}: ${fg} on ${bg} is ${row.ratio}:1, under the ${need}:1 WCAG AA minimum for ${row.kind}`);
  }
  if (!results.length && Object.keys(components).length) problems.push('no component names both textColor and backgroundColor, so nothing can be checked');
  return { results, problems };
}

if (isMain(import.meta.url)) {
  const file = process.argv[2] || 'docs/DESIGN.md';
  try {
    if (!existsSync(file)) throw new Error(`${file} not found: the designer writes it (docs/templates/DESIGN.md is the starting point)`);
    const { results, problems } = checkDesign(frontMatter(readFileSync(file, 'utf8')));
    for (const r of results) console.log(`  ${r.ratio >= r.need ? 'ok  ' : 'FAIL'} ${r.ratio.toFixed(2).padStart(5)}:1 (need ${r.need}:1, ${r.kind})  ${r.name}: ${r.fg} on ${r.bg}`);
    if (problems.length) {
      console.error(`gate:design: FAIL, ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
      process.exitCode = 1;
    } else console.log(`gate:design: OK (${results.length} colour pairs meet WCAG AA [M: computed from ${file}])`);
  } catch (e) {
    console.error(`gate:design: ${e.message}`);
    process.exitCode = 1;
  }
}
