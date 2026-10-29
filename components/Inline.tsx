import Link from 'next/link';
import type { ReactNode } from 'react';

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** The links in a content string: internal paths and https URLs only; anything else stays plain text. */
export function parseInline(text: string): ({ text: string } | { text: string; href: string; external: boolean })[] {
  const parts: ({ text: string } | { text: string; href: string; external: boolean })[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const [whole, words, href] = m as unknown as [string, string, string];
    const internal = /^\/(?!\/)[\w/.#-]*$/.test(href);
    const external = /^https:\/\/[^\s"'<>]+$/.test(href);
    if (!internal && !external) continue;
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: words, href, external });
    last = m.index! + whole.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** A content string as React nodes: text stays text (React escapes it); [words](href) becomes a link. */
export default function Inline({ text }: { text: string }): ReactNode {
  return parseInline(text).map((p, i) =>
    'href' in p ? (
      p.external ? (
        <a key={i} href={p.href} rel="noopener">
          {p.text}
        </a>
      ) : (
        <Link key={i} href={p.href}>
          {p.text}
        </Link>
      )
    ) : (
      p.text
    ),
  );
}
