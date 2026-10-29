'use client';

import { useId, useState } from 'react';
import { track } from '@/lib/analytics';
import { KINDS, measure, type Kind } from '@/lib/tools/length';

/**
 * The example tool: checks a page title or meta description against the kit's length rules, in the browser (no
 * network calls; eslint.config.mjs blocks fetch in components/tools/). The result is a live region, announced as it
 * changes, and is already in the static HTML for the preset text.
 */
export default function LengthChecker({ preset }: { preset?: Record<string, string | number> }) {
  const id = useId();
  const [kind, setKind] = useState<Kind>(preset?.kind === 'description' ? 'description' : 'title');
  const [text, setText] = useState(String(preset?.text ?? ''));
  const [used, setUsed] = useState(false);
  const result = measure(kind, text);
  const touched = () => {
    if (!used) track('tool_used', { tool: 'length-checker' });
    setUsed(true);
  };

  return (
    <form className="tool" aria-label="Title and description length checker" onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>What are you checking?</legend>
        {KINDS.map((k) => (
          <div key={k.id} className="choice">
            <input id={`${id}-${k.id}`} type="radio" name={`${id}-kind`} value={k.id} checked={kind === k.id} onChange={() => { setKind(k.id); touched(); }} />
            <label htmlFor={`${id}-${k.id}`}>{`${k.label} (${k.min}–${k.max} characters)`}</label>
          </div>
        ))}
      </fieldset>
      <div className="fields">
        <label htmlFor={`${id}-text`}>Text to check</label>
        <textarea id={`${id}-text`} rows={3} autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); touched(); }} />
      </div>
      <output className="result" aria-live="polite" htmlFor={`${id}-text`}>
        {result.ok ? (
          <>
            <strong>{result.text}</strong>
            <span className="steps">{result.steps.join(' ')}</span>
          </>
        ) : (
          <span className="steps">{result.error}</span>
        )}
      </output>
    </form>
  );
}
