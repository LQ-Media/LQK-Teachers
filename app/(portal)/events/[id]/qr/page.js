import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getQrEvent, qrStats, listFamilies } from "@/lib/events/passport-queries";
import PageHeading from "@/components/PageHeading";
import QrCode from "@/components/events/QrCode";
import QrStudio from "./QrStudio";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const event = getQrEvent(id);
  return { title: `QR Registration · ${event?.title || "Event"} · LQK Teachers Portal` };
}

export default async function QrRegistrationPage({ params }) {
  await requireRole(["admin"]);
  const { id } = await params;

  const event = getQrEvent(id);
  if (!event) notFound();

  const baseUrl = (process.env.LQK_PUBLIC_BASE_URL || "https://teachers.littlequrankids.sg").replace(/\/+$/, "");

  return (
    <div className="max-w-4xl px-4 py-6 sm:p-8">
      <Link href={`/events/${id}`} className="mb-4 inline-block text-sm text-gold hover:underline">
        ← {event.title}
      </Link>

      <PageHeading
        route="/events"
        icon="calendar"
        tone="honey"
        title="QR Registration"
        subtitle="Families scan in at the door, then collect letters around the hall"
      />

      <QrStudio
        event={event}
        stats={qrStats(id)}
        families={listFamilies(id)}
        baseUrl={baseUrl}
        /* Rendered here, on the server, and handed down as a node: the encoder
           is pure JS and would work in the browser, but shipping it into the
           client bundle to draw one static symbol is pure weight. */
        doorQr={
          <QrCode
            value={`${baseUrl}/q/e/${event.slug}`}
            size={180}
            title={`Check in to ${event.title}`}
          />
        }
      />
    </div>
  );
}
