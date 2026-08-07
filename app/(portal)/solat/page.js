import { requireSession } from "@/lib/dal";
import PageHeading from "@/components/PageHeading";
import AzanSettingsClient from "@/components/solat/AzanSettingsClient";

export const metadata = { title: "Solat & Azan · LQK Teachers Portal" };

export default async function SolatPage() {
  await requireSession();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:p-8">
      <header className="mb-5">
        <PageHeading
          route="/solat"
          icon="bell"
          title="Solat & Azan"
          subtitle="Today’s prayer times, and which prayers should auto-play the azan on this device."
        />
      </header>
      <AzanSettingsClient />
    </div>
  );
}
