import Icon from "@/components/Icon";

/**
 * Renders a normalised note summary. Shared by the owner's view
 * (/notebook/[id]) and the Ilmu Bank's public view (/ilmu/[id]) so the two can
 * never drift — notably the "Check these yourself" block and the authority
 * disclaimer, which must appear wherever a summary is read.
 *
 * Plain component, no client hooks; safe to render from a Server Component.
 */
export default function NoteSummary({ summary }) {
  if (!summary) return null;

  return (
    <div className="space-y-6">
      {summary.overview && (
        <p className="rounded-card border-[0.5px] border-line bg-gradient-to-br from-white to-[#faf5ed] p-5 text-[14px] leading-relaxed text-charcoal">
          {summary.overview}
        </p>
      )}

      {summary.points.length > 0 && (
        <Section title="Key points" icon="notebook">
          <ol className="space-y-4">
            {summary.points.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gold-soft text-[11px] font-bold text-ink">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  {p.heading && <p className="font-heading text-[14px] font-bold text-charcoal">{p.heading}</p>}
                  {p.detail && (
                    <p className="mt-0.5 text-[13px] leading-relaxed text-charcoal-soft">{p.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {summary.references.length > 0 && (
        <Section
          title="References mentioned"
          icon="book-open"
          note="Always check a citation against the original before you teach it."
        >
          <ul className="space-y-2.5">
            {summary.references.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="rounded-pill bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-soft">
                  {r.type}
                </span>
                <span className="font-heading text-[14px] font-bold text-charcoal">{r.label}</span>
                {r.verseKey && (
                  <span className="rounded-pill bg-gold-soft px-2 py-0.5 text-[11px] font-bold text-ink">
                    {r.verseKey}
                  </span>
                )}
                {r.detail && <span className="w-full text-[13px] text-charcoal-soft">{r.detail}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {summary.glossary.length > 0 && (
        <Section title="Terms" icon="type">
          <dl className="grid gap-3 sm:grid-cols-2">
            {summary.glossary.map((g, i) => (
              <div key={i} className="rounded-control bg-paper px-3.5 py-2.5">
                <dt className="flex items-baseline justify-between gap-2">
                  <span className="font-heading text-[14px] font-bold text-charcoal">{g.term}</span>
                  {g.arabic && (
                    <span className="font-arabic text-[16px] leading-none text-ink" dir="rtl">
                      {g.arabic}
                    </span>
                  )}
                </dt>
                <dd className="mt-1 text-[12px] leading-relaxed text-charcoal-soft">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {summary.classUse.length > 0 && (
        <Section title="Ideas for your class" icon="users">
          <ul className="space-y-2">
            {summary.classUse.map((c, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-charcoal">
                <span className="mt-1 flex-shrink-0 text-gold">
                  <Icon name="check" size={14} />
                </span>
                {c}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {summary.uncertain.length > 0 && (
        <div className="rounded-card border border-[#E4C9B8] bg-rust-soft p-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[#8A4030]">
              <Icon name="alert-triangle" size={16} />
            </span>
            <h2 className="font-heading text-[15px] font-bold text-[#8A4030]">Check these yourself</h2>
          </div>
          <ul className="space-y-1.5">
            {summary.uncertain.map((u, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-[#8A4030]">
                · {u}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, note, children }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-gold">
          <Icon name={icon} size={16} />
        </span>
        <h2 className="font-heading text-[15px] font-bold text-charcoal">{title}</h2>
      </div>
      {note && <p className="mb-3 text-[12px] text-charcoal-soft">{note}</p>}
      {children}
    </section>
  );
}
