const STYLES = {
  lancar: "bg-[#F6D3DD] text-[#6B3E4C]",
  mutqin: "bg-[#DCD3F0] text-[#4A3D63]",
  approved: "bg-[#DCD3F0] text-[#4A3D63]",
  needs_review: "bg-[#FBE3E8] text-[#8E3D52]",
  rejected: "bg-[#FBE3E8] text-[#8E3D52]",
  pending: "bg-[#FBDCC8] text-[#6E4830]",
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
