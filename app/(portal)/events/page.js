import { requireRole } from "@/lib/dal";
import { eventsOverview } from "@/lib/actions/events";
import EventsApp from "@/components/events/EventsApp";

export const metadata = { title: "Event invites · LQK Teachers Portal" };

export default async function EventsPage() {
  await requireRole(["admin"]);
  const { events, lists, channels } = await eventsOverview();
  return <EventsApp events={events} lists={lists} channels={channels} />;
}
