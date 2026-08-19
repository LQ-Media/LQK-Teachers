import Link from "next/link";
import { getBoothSession } from "@/lib/events/booth-session";
import { getQrEvent } from "@/lib/events/passport-queries";
import RedeemDesk from "./RedeemDesk";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Prize counter",
  robots: { index: false, follow: false },
};

export default async function RedeemPage() {
  const session = await getBoothSession();
  const event = session ? getQrEvent(session.eventId) : null;

  // The desk shares the scanner's sign-in rather than owning a second one: one
  // PIN, typed once per phone, and a volunteer moved from a booth to the
  // counter mid-event doesn't have to find Karim again.
  if (!event || !event.qr_enabled) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-sm px-5 py-12">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">Prize counter</h1>
        <p className="mt-2 text-sm text-charcoal-soft">
          Sign in on the booth screen first — the same PIN covers this one.
        </p>
        <Link
          href="/q/booth"
          className="mt-6 inline-block rounded-pill bg-ink px-6 py-3.5 text-base font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  return <RedeemDesk eventTitle={event.title} />;
}
