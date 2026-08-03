import { requireSession } from "@/lib/dal";
import { allowedClassesFor } from "@/lib/tracker/access";
import { getRoster } from "@/lib/actions/tracker";
import PageHeading from "@/components/PageHeading";
import TrackerApp from "@/components/tracker/TrackerApp";

export const metadata = { title: "Quran tracker · LQK Teachers Portal" };

export default async function HafalanPage() {
  const session = await requireSession();
  const allowedClasses = allowedClassesFor(session);

  if (allowedClasses.length === 0) {
    return (
      <div className="p-8 max-w-3xl">
        <PageHeading
          icon="clipboard-check"
          title="Quran tracker"
          subtitle="No class is assigned to your account yet. Ask an admin to set your branch so your student roster appears here."
        />
      </div>
    );
  }

  const initialClass = allowedClasses[0];
  const initialRoster = await getRoster(initialClass);

  return (
    <TrackerApp
      teacherName={session.fullName ? session.fullName.split(" ")[0] : "Teacher"}
      allowedClasses={allowedClasses}
      initialClass={initialClass}
      initialRoster={initialRoster}
    />
  );
}
