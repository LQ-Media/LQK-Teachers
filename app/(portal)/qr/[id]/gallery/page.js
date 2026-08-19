import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { getQrEvent, listPhotos } from "@/lib/qr/queries";
import PhotoWall from "./PhotoWall";

/* Every family picture from one event, as a wall and as a slideshow.

   requireSession, not requireRole(["admin"]) — Karim asked for this so
   TEACHERS could see them, and the person driving the screen in the hall is
   rarely the one with the admin login.

   It is NOT public, though, and that is deliberate: these are photographs of
   children, and the families agreed to LQK making a picture, not to it being
   put behind a link anyone could forward. A signed-in laptop drives the
   screen, which is how a hall display works anyway. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const event = getQrEvent(id);
  return {
    title: `Family pictures · ${event?.title || "Event"}`,
    robots: { index: false, follow: false },
  };
}

export default async function GalleryPage({ params }) {
  const session = await requireSession();
  const { id } = await params;

  const event = getQrEvent(id);
  if (!event) notFound();

  const photos = listPhotos(id);
  // Admins can take a picture down from here; everyone else is a viewer.
  const canDelete = session.role === "admin";

  return (
    <div className="px-4 py-6 sm:p-8">
      <Link
        href={canDelete ? `/qr/${id}` : "/dashboard"}
        className="mb-4 inline-block text-sm text-gold hover:underline"
      >
        ← {canDelete ? event.title : "Dashboard"}
      </Link>

      <PhotoWall
        eventId={id}
        eventTitle={event.title}
        photos={photos}
        canDelete={canDelete}
      />
    </div>
  );
}
