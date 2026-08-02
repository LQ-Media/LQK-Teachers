import { requireSession } from "@/lib/dal";
import { getQuranBookmark } from "@/lib/actions/quran";
import QuranReader from "@/components/quran/QuranReader";
import ReaderHeartbeat from "@/components/quran/ReaderHeartbeat";

export const metadata = {
  title: "Quran reader · LQK Teachers Portal",
};

export default async function QuranPage() {
  await requireSession();
  // Read the bookmark server-side so the "continue reading" banner is present
  // on first paint, before any client-side fetch.
  const initialBookmark = await getQuranBookmark();

  return (
    <>
      <QuranReader initialBookmark={initialBookmark} />
      {/* Renders nothing; records reading time for the Achievements streak. */}
      <ReaderHeartbeat />
    </>
  );
}
