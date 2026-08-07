import { requireSession } from "@/lib/dal";
import AzanSettingsClient from "@/components/solat/AzanSettingsClient";

export const metadata = { title: "Solat & Azan · LQK Teachers Portal" };

export default async function SolatPage() {
  await requireSession();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:p-8">
      <header className="mb-5">
        <h1 className="font-heading text-[26px] font-bold leading-tight text-charcoal">Solat &amp; Azan</h1>
        <p className="mt-1 text-[13px] text-charcoal-soft">
          Today&apos;s prayer times, and which prayers should auto-play the azan on this device.
        </p>
      </header>
      <AzanSettingsClient />
    </div>
  );
}
