const STYLES = {
  lancar: "bg-[#F3D9C8] text-[#7A4630]",
  mutqin: "bg-[#DDE5D3] text-[#3E5438]",
  approved: "bg-[#DDE5D3] text-[#3E5438]",
  needs_review: "bg-[#F8E2D8] text-[#8E3A24]",
  rejected: "bg-[#F8E2D8] text-[#8E3A24]",
  pending: "bg-[#F8E3BE] text-[#6E5320]",
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
