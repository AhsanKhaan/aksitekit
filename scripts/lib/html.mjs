// HTML and URL helpers for the gates: a small tokenizer instead of regex HTML filtering, a single-pass entity decoder,
// and hostname checks that parse URLs instead of matching unanchored patterns. No dependencies.
//
// The gates read the site's own built output, never untrusted HTML that is later rendered. The tokenizer still follows
// the HTML parsing rules that matter for text extraction: comments end at "-->" or "--!>", raw-text elements (script,
// style, ...) end only at a matching end tag in any case and with any whitespace or attributes ("</script >",
// "</SCRIPT\n>"), and quoted attribute values may contain ">".

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes character references in one pass, so "&amp;lt;" becomes "&lt;", never "<". A no-break space reads as a space. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
    const r = ref.toLowerCase();
    if (r.startsWith('#x')) return safeCodePoint(parseInt(r.slice(2), 16), whole);
    if (r.startsWith('#')) return safeCodePoint(Number(r.slice(1)), whole);
    return NAMED[r] ?? whole;
  }).replace(/\xa0/g, ' ');
}
function safeCodePoint(n, fallback) {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback;
}

/** Elements the HTML parser reads as raw text: their content is never markup, and only their own end tag closes them. */
export const RAW_TEXT = ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'textarea', 'title'];
/** Elements whose content is not prose a reader sees, always skipped by htmlText(). */
export const NOT_TEXT = ['script', 'style', 'svg', 'noscript', 'template'];

/** Index just past the ">" that ends the tag starting at `start` ("<..."), honouring quoted attribute values. */
function tagEnd(html, start) {
  let quote = '';
  for (let i = start + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) { if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
  }
  return html.length;
}

/** Index where the end tag of raw-text element `name` begins at or after `from` (or html.length). */
function rawTextEnd(html, name, from) {
  const lower = html.toLowerCase();
  let i = from;
  for (;;) {
    i = lower.indexOf('</' + name, i);
    if (i < 0) return html.length;
    const next = lower[i + 2 + name.length];
    if (next === undefined || next === '>' || next === '/' || /\s/.test(next)) return i;
    i += 2;
  }
}

/**
 * Tokenizes HTML into a flat list: { type: 'text', value } | { type: 'start', name, raw, selfClosing } |
 * { type: 'end', name } | { type: 'comment' }. Raw-text elements yield their start tag, one 'raw' token
 * ({ type: 'raw', name, value }) and their end tag.
 */
export function tokenize(html) {
  const s = String(html);
  const out = [];
  let i = 0;
  let text = '';
  const flush = () => { if (text) { out.push({ type: 'text', value: text, index: i - text.length }); text = ''; } };
  while (i < s.length) {
    const c = s[i];
    if (c !== '<') { text += c; i++; continue; }
    if (s.startsWith('<!--', i)) {
      flush();
      let end = s.indexOf('-->', i + 4);
      const bang = s.indexOf('--!>', i + 4);
      if (bang >= 0 && (end < 0 || bang < end)) end = bang + 1;
      i = end < 0 ? s.length : end + 3;
      out.push({ type: 'comment' });
      continue;
    }
    const m = /^<(\/?)([a-z][a-z0-9:-]*)/i.exec(s.slice(i, i + 64));
    if (!m) {
      // "<!doctype ...>", "<?xml ...>" or a stray "<": skip declarations, keep a stray "<" as text.
      if (s[i + 1] === '!' || s[i + 1] === '?') { flush(); i = tagEnd(s, i); continue; }
      text += c; i++; continue;
    }
    flush();
    const start = i;
    const end = tagEnd(s, i);
    const name = m[2].toLowerCase();
    const raw = s.slice(start, end);
    if (m[1]) { out.push({ type: 'end', name, index: start }); i = end; continue; }
    const selfClosing = raw.endsWith('/>');
    out.push({ type: 'start', name, raw, selfClosing, index: start });
    i = end;
    if (RAW_TEXT.includes(name) && !selfClosing) {
      const close = rawTextEnd(s, name, i);
      out.push({ type: 'raw', name, value: s.slice(i, close), index: i });
      if (close < s.length) { out.push({ type: 'end', name, index: close }); i = tagEnd(s, close); } else i = s.length;
    }
  }
  flush();
  return out;
}

const BLOCKS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'tr', 'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'figcaption', 'caption', 'dd', 'dt', 'blockquote', 'pre', 'summary', 'label', 'button', 'option']);

/**
 * The visible text of an HTML fragment, decoded.
 * @param {string} html
 * @param {{ drop?: string[], sep?: string, blocks?: boolean }} [o]
 *   drop: extra elements whose whole content is skipped (e.g. nav, aside, form); sep: what replaces a tag (' ' by
 *   default; '' reads text like textContent); blocks: ' . ' after block-level end tags and <br>. NOT_TEXT elements
 *   (script, style, svg, noscript, template) are always skipped.
 */
export function htmlText(html, { drop = [], sep = ' ', blocks = false } = {}) {
  const skip = new Set([...NOT_TEXT, ...drop.map((d) => d.toLowerCase())]);
  let depth = 0;
  let skipping = '';
  let out = '';
  for (const t of tokenize(html)) {
    if (skipping) {
      if (t.type === 'start' && t.name === skipping && !t.selfClosing) depth++;
      else if (t.type === 'end' && t.name === skipping && --depth === 0) skipping = '';
      if (!skipping) out += sep;
      continue;
    }
    if (t.type === 'text' || t.type === 'raw') out += t.value;
    else if (t.type === 'start') {
      if (skip.has(t.name) && !t.selfClosing) { skipping = t.name; depth = 1; continue; }
      out += blocks && t.name === 'br' ? ' . ' : sep;
    } else if (t.type === 'end') out += blocks && BLOCKS.has(t.name) ? ' . ' : sep;
    else out += sep;
  }
  return decodeEntities(out).replace(/\s+/g, ' ').trim();
}

/**
 * Every element `name` in `html`: its start tag's attribute text, its inner HTML and its index. Raw-text elements
 * (script, style) are matched by the tokenizer's end-tag rule, so "</script >" and "</SCRIPT>" close them too.
 */
export function elementsOf(html, name) {
  const want = name.toLowerCase();
  const s = String(html);
  const toks = tokenize(s);
  const found = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type !== 'start' || t.name !== want) continue;
    const attrText = t.raw.replace(/^<[a-z][a-z0-9:-]*/i, '').replace(/\/?>$/, '');
    if (t.selfClosing) { found.push({ attrs: attrText, inner: '', index: t.index }); continue; }
    let depth = 1;
    let j = k + 1;
    for (; j < toks.length; j++) {
      const u = toks[j];
      if (u.type === 'start' && u.name === want && !u.selfClosing) depth++;
      else if (u.type === 'end' && u.name === want && --depth === 0) break;
    }
    const innerStart = t.index + t.raw.length;
    const innerEnd = j < toks.length ? toks[j].index : s.length;
    found.push({ attrs: attrText, inner: s.slice(innerStart, innerEnd), index: t.index });
  }
  return found;
}

/** Lower-case hostname of an absolute or protocol-relative URL, or '' when it has none. */
export function hostOfUrl(url) {
  const u = String(url ?? '').trim();
  if (!/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(u)) return '';
  try {
    return new URL(u.startsWith('//') ? `https:${u}` : u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** True when `host` is `domain` or one of its subdomains (exact label match, never a suffix of another name). */
export function hostIs(host, domain) {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
  const d = String(domain ?? '').toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  return !!h && !!d && (h === d || h.endsWith(`.${d}`));
}

/**
 * Hostnames named in a text: absolute and protocol-relative URLs, and CSP source expressions ("https://x.example",
 * "*.example.com", "x.example.com"). Used to ask "does this CSP / page reference host X" without substring matching.
 */
export function hostsIn(text) {
  const hosts = new Set();
  // "=" is not a separator: a query value (?u=evil.example) must stay part of its URL, never read as a host. An
  // unquoted attribute (src=https://...) loses its name= prefix instead.
  for (const token of String(text ?? '').split(/[\s;,'"()<>`]+/)) {
    const raw = token.replace(/^[\w:-]+=(?=[\w*/])/, '');
    if (!raw) continue;
    let h = hostOfUrl(raw);
    if (!h) {
      // CSP host source without a scheme: [*.]host[:port][/path]
      const m = /^(?:\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+|:\*)?(?:\/.*)?$/i.exec(raw);
      if (m) h = m[1].toLowerCase();
    }
    if (h) hosts.add(h);
  }
  return hosts;
}

/** True when any host named in `text` is `domain` or a subdomain of it. */
export function mentionsHost(text, domain) {
  for (const h of hostsIn(text)) if (hostIs(h, domain)) return true;
  return false;
}

/** The text of every <script type="application/ld+json"> element. */
export function jsonLdScripts(html) {
  return elementsOf(html, 'script')
    .filter((s) => /\btype\s*=\s*["']?application\/ld\+json\b/i.test(s.attrs))
    .map((s) => s.inner);
}
