"use client";

import { useActionState, useState } from "react";
import { submitHafalan } from "@/lib/actions/hafalan";
import { JUZ_AMMA_SURAHS } from "@/lib/surahs";

const RATINGS = [
  { value: "lancar", label: "Lancar" },
  { value: "mutqin", label: "Mutqin" },
  { value: "needs_review", label: "Needs review" },
];

const RATING_STYLES = {
  lancar: "bg-[#FBF0D9] border-[#8A6307] text-[#8A6307]",
  mutqin: "bg-[#F2E4C8] border-[#7A5419] text-[#7A5419]",
  needs_review: "bg-[#F2DDD5] border-[#8A4030] text-[#8A4030]",
};

export default function HafalanLogForm({ defaultSurah, defaultOpen }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [rating, setRating] = useState("");
  const [, formAction, pending] = useActionState(async (_prev, formData) => {
    await submitHafalan(formData);
    setOpen(false);
    setRating("");
    return null;
  }, null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-ink text-paper rounded-control px-[18px] py-[10px] text-[13px] font-semibold hover:bg-ink-deep transition-colors"
      >
        + Log a surah
      </button>
    );
  }

  return (
    <form action={formAction} className="bg-white border-[0.5px] border-line rounded-card p-5 mb-2">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-charcoal-soft">Surah</label>
          <select
            name="surah_number"
            defaultValue={defaultSurah || ""}
            required
            className="bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
          >
            <option value="" disabled>
              Select a surah
            </option>
            {JUZ_AMMA_SURAHS.map((s) => (
              <option key={s.number} value={s.number}>
                {s.number}. {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-charcoal-soft">Rating</label>
          <div className="flex gap-2">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRating(r.value)}
                className={`flex-1 text-[12px] font-semibold rounded-control border-[1px] px-2 py-[9px] transition-colors ${
                  rating === r.value ? RATING_STYLES[r.value] : "bg-paper border-line text-charcoal-soft"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <input type="hidden" name="rating" value={rating} required />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mb-4">
        <label className="text-[11px] font-semibold text-charcoal-soft">Note (optional)</label>
        <textarea
          name="note"
          rows={2}
          placeholder="e.g. Still mixing up ayah 4 and 5 word order."
          className="bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink resize-none"
        />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending || !rating}
          className="bg-ink text-paper rounded-control px-[18px] py-[10px] text-[13px] font-semibold hover:bg-ink-deep disabled:opacity-60 transition-colors"
        >
          {pending ? "Submitting…" : "Submit for review"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] font-semibold text-ink px-1 py-[10px]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
