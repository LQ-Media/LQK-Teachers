"use client";

import { useState } from "react";
import { approveHafalan, rejectHafalan } from "@/lib/actions/hafalan";
import { formatDate } from "@/lib/date";
import StatusPill from "@/components/StatusPill";

const RATING_LABEL = { lancar: "Lancar", mutqin: "Mutqin", needs_review: "Needs review" };
const RATING_STATUS = { lancar: "lancar", mutqin: "mutqin", needs_review: "needs_review" };

export default function ReviewCard({ entry }) {
  const [rejecting, setRejecting] = useState(false);

  return (
    <div className="bg-white border-[0.5px] border-line rounded-card p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[13px] font-semibold text-charcoal">{entry.full_name}</div>
          <div className="text-[11px] text-charcoal-soft">
            {entry.primary_location ?? "No location"} · {entry.surah_name} · {formatDate(entry.created_at)}
          </div>
        </div>
        <StatusPill status={RATING_STATUS[entry.rating]} label={RATING_LABEL[entry.rating]} />
      </div>

      {entry.note && (
        <div className="bg-paper-deep rounded-control p-3 text-[12px] text-charcoal mb-4">{entry.note}</div>
      )}

      {!rejecting ? (
        <div className="flex gap-3">
          <form action={approveHafalan}>
            <input type="hidden" name="entry_id" value={entry.id} />
            <button
              type="submit"
              className="bg-ink text-paper rounded-control px-[18px] py-[10px] text-[13px] font-semibold hover:bg-ink-deep transition-colors"
            >
              Approve
            </button>
          </form>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="bg-rust-soft text-[#8A4030] rounded-control px-[18px] py-[10px] text-[13px] font-semibold hover:bg-[#efc9bd] transition-colors"
          >
            Reject
          </button>
        </div>
      ) : (
        <form action={rejectHafalan} className="flex flex-col gap-3">
          <input type="hidden" name="entry_id" value={entry.id} />
          <textarea
            name="reviewer_note"
            required
            rows={2}
            placeholder="Explain what needs work before this can be approved…"
            className="bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink resize-none"
          />
          <div className="flex gap-3">
            <button
              type="submit"
              className="bg-rust text-white rounded-control px-[18px] py-[10px] text-[13px] font-semibold hover:opacity-90 transition-opacity"
            >
              Send back to teacher
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="text-[12px] font-semibold text-ink px-1 py-[10px]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
