import Inline from '@/components/Inline';

/** Questions people ask next, as plain headings and answers (also marked up as FAQPage JSON-LD). */
export default function Faq({ faq }: { faq: { q: string; a: string }[] }) {
  return (
    <section aria-labelledby="faq">
      <h2 id="faq">Questions</h2>
      {faq.map((f) => (
        <div key={f.q} className="faq-item">
          <h3>{f.q}</h3>
          <p>
            <Inline text={f.a} />
          </p>
        </div>
      ))}
    </section>
  );
}
