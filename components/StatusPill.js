const STYLES = {
  lancar: "bg-[#FCE9F0] text-[#8E4A66]",
  mutqin: "bg-[#EEE9F9] text-[#5E3448]",
  approved: "bg-[#EEE9F9] text-[#5E3448]",
  needs_review: "bg-[#FBE3E8] text-[#8E3D52]",
  rejected: "bg-[#FBE3E8] text-[#8E3D52]",
  pending: "bg-[#F6ECF8] text-[#7B62B0]",
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
