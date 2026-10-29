import Inline from '@/components/Inline';
import type { Block } from '@/lib/content/schema';

/** One content block: a paragraph, a list, a table (caption and header cells required) or a note. */
export function BlockView({ block }: { block: Block }) {
  if ('p' in block) return <p><Inline text={block.p} /></p>;
  if ('ul' in block) return <ul>{block.ul.map((t, i) => <li key={i}><Inline text={t} /></li>)}</ul>;
  if ('ol' in block) return <ol>{block.ol.map((t, i) => <li key={i}><Inline text={t} /></li>)}</ol>;
  if ('note' in block) return <p className="note"><Inline text={block.note} /></p>;
  const t = block.table;
  return (
    <div className="table-wrap">
      <table>
        <caption>{t.caption}</caption>
        <thead>
          <tr>{t.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sections as h2 headings with their blocks; `level` lets a page nest them under its own h2. */
export default function Sections({ sections, level = 2 }: { sections: { heading: string; id?: string; blocks: Block[] }[]; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  return sections.map((s) => (
    <section key={s.heading} aria-labelledby={s.id ?? undefined}>
      <H id={s.id}>{s.heading}</H>
      {s.blocks.map((b, i) => <BlockView key={i} block={b} />)}
    </section>
  ));
}
