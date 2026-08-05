import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { normalisePack } from "@/lib/ai/provider";
import { ageLabel } from "@/lib/notes/taxonomy";
import Icon from "@/components/Icon";
import PackReview from "@/components/packs/PackReview";

export default async function PackPage({ params }) {
  const { id } = await params;
  const session = await requireSession();
  const canReview = session.role === "reviewer" || session.role === "admin";
  const db = getDb();

  const row = db.prepare("SELECT * FROM lesson_packs WHERE id = ?").get(id);
  if (!row) notFound();
  // A draft is a work in progress; teachers shouldn't stumble onto one.
  if (row.status !== "approved" && !canReview) notFound();

  const rules = safeParse(row.tajweed, []);
  const ayat = safeParse(row.ayat, []);
  const pack = normalisePack(safeParse(row.content, {}), { rules });

  const approver = row.approved_by
    ? db.prepare("SELECT full_name FROM profiles WHERE id = ?").get(row.approved_by)?.full_name
    : null;

  const totalMinutes = pack.activities.reduce((s, a) => s + a.minutes, 0);

  return (
    <div className="px-4 py-6 sm:p-8 max-w-3xl">
      <Link
        href="/packs"
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-charcoal-soft transition-colors hover:text-charcoal"
      >
        <Icon name="arrow-left" size={15} />
        Lesson Packs
      </Link>

      {row.status === "draft" && (
        <div className="mb-5 flex items-start gap-2.5 rounded-control bg-rust-soft px-4 py-3 text-[13px] text-[#8E3D52]">
          <span className="mt-0.5 flex-shrink-0">
            <Icon name="alert-triangle" size={16} />
          </span>
          <p>
            <strong>Draft — not yet approved.</strong> Read it through before approving; teachers cannot
            see this until you do.
          </p>
        </div>
      )}

      <h1 className="font-heading text-2xl font-semibold leading-tight text-charcoal">{row.label}</h1>
      <p className="mt-1.5 text-[13px] text-charcoal-soft">
        {ageLabel(row.age_group)} · 30 minutes
        {approver && row.status === "approved" ? ` · approved by ${approver}` : ""}
      </p>

      {pack.objective && (
        <p className="mt-6 rounded-card border-[0.5px] border-line bg-gradient-to-br from-white to-[#FDF3F7] p-5 text-[14px] leading-relaxed text-charcoal">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">
            By the end
          </span>
          {pack.objective}
        </p>
      )}

      {/* The ayat themselves — the reference panel a teacher keeps open. */}
      {ayat.length > 0 && (
        <Section title="The portion" icon="book-open">
          <ol className="space-y-3">
            {ayat.map((a) => (
              <li key={a.key} className="rounded-control bg-paper px-4 py-3">
                <p className="font-arabic text-[22px] leading-loose text-ink" dir="rtl">
                  {a.arabic}
                </p>
                {a.translation && (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-charcoal-soft">
                    <span className="font-semibold text-charcoal">{a.key}</span> — {a.translation}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {pack.hook && (
        <Section title="Opening" icon="sparkles">
          <p className="text-[13px] leading-relaxed text-charcoal">{pack.hook}</p>
        </Section>
      )}

      {pack.tajweedFocus.length > 0 && (
        <Section
          title="Tajweed focus"
          icon="type"
          note="These rules were read from the mushaf itself, not guessed."
        >
          <ul className="space-y-3">
            {pack.tajweedFocus.map((t) => (
              <li key={t.rule} className="rounded-control bg-paper px-4 py-3">
                <p className="font-heading text-[14px] font-bold text-charcoal">{t.label}</p>
                {t.howToTeach && (
                  <p className="mt-1 text-[13px] leading-relaxed text-charcoal-soft">{t.howToTeach}</p>
                )}
                {t.drill && (
                  <p className="mt-2 text-[13px] leading-relaxed text-charcoal">
                    <span className="font-semibold">Drill:</span> {t.drill}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {pack.activities.length > 0 && (
        <Section title={`Run of the lesson · ${totalMinutes} min`} icon="clock">
          <ol className="space-y-3">
            {pack.activities.map((a, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-11 w-11 flex-shrink-0 flex-col items-center justify-center rounded-control bg-gold-soft text-ink">
                  <span className="font-heading text-[14px] font-bold leading-none">{a.minutes}</span>
                  <span className="text-[9px] font-bold uppercase leading-none">min</span>
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="font-heading text-[14px] font-bold text-charcoal">{a.name}</p>
                  {a.how && (
                    <p className="mt-0.5 text-[13px] leading-relaxed text-charcoal-soft">{a.how}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {pack.commonMistakes.length > 0 && (
        <Section title="Watch out for" icon="alert-triangle">
          <ul className="space-y-2">
            {pack.commonMistakes.map((m, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-charcoal">
                <span className="mt-1 flex-shrink-0 text-gold">
                  <Icon name="minus" size={12} />
                </span>
                {m}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {pack.parentNote && (
        <Section title="Note home to parents" icon="mail">
          <p className="rounded-control border border-dashed border-line bg-white px-4 py-3 text-[13px] leading-relaxed text-charcoal">
            {pack.parentNote}
          </p>
        </Section>
      )}

      {pack.uncertain.length > 0 && (
        <div className="mt-6 rounded-card border border-[#F2D8E1] bg-rust-soft p-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[#8E3D52]">
              <Icon name="alert-triangle" size={16} />
            </span>
            <h2 className="font-heading text-[15px] font-bold text-[#8E3D52]">Check before teaching</h2>
          </div>
          <ul className="space-y-1.5">
            {pack.uncertain.map((u, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-[#8E3D52]">
                · {u}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 text-[12px] leading-relaxed text-charcoal-soft">
        The ayat and tajweed rules above come from the mushaf. The teaching method was drafted
        automatically and reviewed by a colleague — adapt it to your own class.
      </p>

      {canReview && <PackReview id={row.id} status={row.status} />}
    </div>
  );
}

function Section({ title, icon, note, children }) {
  return (
    <section className="mt-7">
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

function safeParse(json, fallback) {
  try {
    return JSON.parse(json ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
