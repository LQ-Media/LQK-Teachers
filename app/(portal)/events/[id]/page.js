import { notFound } from "next/navigation";
import { requireRole } from "@/lib/dal";
import { eventDetail } from "@/lib/actions/events";
import InviteBuilder from "@/components/events/InviteBuilder";

export const metadata = { title: "Build invite · LQK Teachers Portal" };

export default async function EventBuilderPage({ params }) {
  await requireRole(["admin"]);
  const { id } = await params;

  const detail = await eventDetail(id);
  if (!detail) notFound();

  return (
    <InviteBuilder
      initialEvent={detail.event}
      initialRecipients={detail.recipients}
      lists={detail.lists}
      channels={detail.channels}
    />
  );
}
