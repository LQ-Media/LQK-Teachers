import { requireSession } from "@/lib/dal";
import QiblaFinder from "@/components/qibla/QiblaFinder";

export const metadata = { title: "Qibla finder · LQK Teachers Portal" };

export default async function QiblaPage() {
  await requireSession();
  // Everything is computed on the device (location + compass), so the page
  // itself only needs to gate on a session.
  return <QiblaFinder />;
}
