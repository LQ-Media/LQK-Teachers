import { requireAssessor } from "@/lib/dal";
import { assessableTeachers, assessmentsByAssessor } from "@/lib/assess/queries";
import { currentPeriod, periodLabel } from "@/lib/assess/periods";
import { sgToday } from "@/lib/hours/rates";
import AssessmentsHome from "@/components/assess/AssessmentsHome";

export const metadata = { title: "Assessments · LQK Teachers Portal" };

export default async function AssessmentsPage() {
  const session = await requireAssessor();
  const period = currentPeriod();
  const teachers = assessableTeachers(session.userId);
  const mine = [
    ...assessmentsByAssessor(session.userId, period.year),
    ...assessmentsByAssessor(session.userId, period.year - 1),
  ];

  return (
    <AssessmentsHome
      teachers={teachers}
      mine={mine}
      today={sgToday()}
      period={{ ...period, label: periodLabel(period.year, period.semester) }}
      isAdmin={session.isAdmin}
    />
  );
}
