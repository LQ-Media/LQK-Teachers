import { notFound } from "next/navigation";
import { requireAssessor } from "@/lib/dal";
import { assessmentDetail } from "@/lib/assess/queries";
import { criteriaByDomain, LEVELS, TARGET_LEVEL, RUBRIC_VERSION } from "@/lib/assess/rubric";
import { sgToday } from "@/lib/hours/rates";
import ScoreForm from "@/components/assess/ScoreForm";

export const metadata = { title: "Assessment · LQK Teachers Portal" };

export default async function AssessmentPage({ params }) {
  const { id } = await params;
  const session = await requireAssessor();
  // Returns null for anyone but the owning assessor or an admin — the teacher
  // being assessed gets a 404, not a hint that the page exists.
  const detail = assessmentDetail(id, session);
  if (!detail) notFound();

  return (
    <ScoreForm
      initial={detail}
      domains={criteriaByDomain()}
      levels={LEVELS}
      target={TARGET_LEVEL}
      rubricVersion={RUBRIC_VERSION}
      today={sgToday()}
    />
  );
}
