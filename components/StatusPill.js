const STYLES = {
  lancar: "bg-[#FBF0D9] text-[#8A6307]",
  mutqin: "bg-[#F2E4C8] text-[#7A5419]",
  approved: "bg-[#F2E4C8] text-[#7A5419]",
  needs_review: "bg-[#F2DDD5] text-[#8A4030]",
  rejected: "bg-[#F2DDD5] text-[#8A4030]",
  pending: "bg-[#F2E9D6] text-[#917D5A]",
};

const LABELS = {
  lancar: "Lancar",
  mutqin: "Mutqin",
  approved: "Approved",
  needs_review: "Needs review",
  rejected: "Rejected",
  pending: "Awaiting review",
};

export default function StatusPill({ status, label }) {
  const style = STYLES[status] ?? "bg-paper-deep text-charcoal-soft";
  const text = label ?? LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center text-[11px] font-bold rounded-pill px-[9px] py-[3px] ${style}`}>
      {text}
    </span>
  );
}
