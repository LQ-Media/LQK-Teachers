import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { getEvent } from "@/lib/events/queries";
import { geminiConfigured } from "@/lib/events/gemini";
import PageHeading from "@/components/PageHeading";
import ThemeStudio from "./ThemeStudio";
// The guest stylesheet, loaded here so the preview is painted by the same rules
// as the real invitation. Everything in it is `.inv-*`-scoped, so it cannot
// bleed into the portal's Tailwind theme.
import "@/app/i/invitation.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const event = getEvent(id);
  return { title: `Design · ${event?.title || "Event"} · LQK Teachers Portal` };
}

export default async function ThemePage({ params }) {
  await requireRole(["admin"]);
  const { id } = await params;

  const event = getEvent(id);
  if (!event) notFound();

  /* A stand-in guest so the preview shows a real name in the greeting slot
     rather than an empty line — the name is a big part of how the invitation
     reads, and a blank there makes every design look wrong. */
  const sampleGuest = { name: "Ustaz Ahmad & family" };

  return (
    <div className="px-4 py-6 sm:p-8">
      <Link href={`/events/${id}`} className="mb-4 inline-block text-sm text-gold hover:underline">
        ← {event.title}
      </Link>

      <PageHeading
        route="/events"
        icon="calendar"
        title="Design studio"
        subtitle="Generate and approve the look of this invitation"
      />

      <ThemeStudio event={event} sampleGuest={sampleGuest} hasGemini={geminiConfigured()} />
    </div>
  );
}
