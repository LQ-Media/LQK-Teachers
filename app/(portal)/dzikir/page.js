import { requireSession } from "@/lib/dal";
import { CATALOG } from "@/lib/dzikir/catalog";
import PageHeading from "@/components/PageHeading";
import DzikirBrowser from "@/components/dzikir/DzikirBrowser";

export const metadata = { title: "Wirid & Doa" };

/**
 * Wirid, Doa & Maulid — a browsable library of ~4,100 devotional passages
 * (Arabic + South-East-Asian transliteration + English and Bahasa translation).
 *
 * The catalogue (CATALOG) carries only titles and counts, so this page ships
 * no Arabic text at all. The passages themselves live in per-section JSON that
 * is code-split and fetched only when a teacher opens that devotional — see
 * lib/dzikir/loaders.js.
 */
export default async function DzikirPage() {
  await requireSession();

  const totalSections = CATALOG.reduce((n, g) => n + g.sections.length, 0);
  const totalPassages = CATALOG.reduce(
    (n, g) => n + g.sections.reduce((m, s) => m + s.count, 0),
    0
  );

  return (
    <div className="px-4 py-6 sm:p-8 max-w-3xl max-lg:pb-20">
      <div className="mb-6">
        <PageHeading
          icon="moon-star"
          title="Wirid & Doa"
          subtitle={`A library of wirid, doa and maulid — ${totalPassages.toLocaleString()} passages across ${totalSections} collections. Arabic with transliteration, shown with English or Bahasa.`}
        />
      </div>

      <DzikirBrowser catalog={CATALOG} />
    </div>
  );
}
