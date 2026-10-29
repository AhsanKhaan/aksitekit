/** The sources the page's facts come from (each one is in the page's brief; check:release verifies that). */
export default function Sources({ sources }: { sources: { title: string; url: string; publisher?: string }[] }) {
  return (
    <section aria-labelledby="sources">
      <h2 id="sources">Sources</h2>
      <ul className="sources">
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} rel="noopener">
              {s.title}
            </a>
            {s.publisher ? `, ${s.publisher}` : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
