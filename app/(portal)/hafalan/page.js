import { requireSession } from "@/lib/dal";
import { allowedClassesFor } from "@/lib/tracker/access";
import { getRoster } from "@/lib/actions/tracker";
import TrackerApp from "@/components/tracker/TrackerApp";

export const metadata = { title: "Quran tracker · LQK Teachers Portal" };

export default async function HafalanPage() {
  const session = await requireSession();
  const allowedClasses = allowedClassesFor(session);

  if (allowedClasses.length === 0) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">Quran tracker</h1>
        <p className="mt-2 text-[13px] text-charcoal-soft">
          No class is assigned to your account yet. Ask an admin to set your branch so your student roster appears here.
        </p>
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
