"use client";

import { useActionState, useState } from "react";
import { logReading } from "@/lib/actions/reading";
import { JUZ_AMMA_SURAHS } from "@/lib/surahs";

export default function ReadingLogForm() {
  const [tab, setTab] = useState("surah");
  const [, formAction, pending] = useActionState(async (_prev, formData) => {
    await logReading(formData);
    return null;
  }, null);

  return (
    <div className="bg-white border-[0.5px] border-line rounded-card p-5">
      <div className="flex gap-1 mb-4 bg-paper-deep rounded-control p-1 w-fit">
        <TabButton active={tab === "surah"} onClick={() => setTab("surah")}>
          Finished a surah
        </TabButton>
        <TabButton active={tab === "session"} onClick={() => setTab("session")}>
          Reading session
        </TabButton>
      </div>

      <form action={formAction} className="flex items-end gap-3">
        <input type="hidden" name="entry_type" value={tab} />
        {tab === "surah" ? (
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-[11px] font-semibold text-charcoal-soft">Surah</label>
            <select
              name="surah_number"
              required
              defaultValue=""
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
        ) : (
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-[11px] font-semibold text-charcoal-soft">Minutes</label>
            <input
              type="number"
              name="session_minutes"
              min="1"
              required
              placeholder="e.g. 20"
              className="bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="bg-ink text-paper rounded-control px-[18px] py-[10px] text-[13px] font-semibold hover:bg-ink-deep disabled:opacity-60 transition-colors"
        >
          {pending ? "Logging…" : "Log it"}
        </button>
      </form>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[12px] font-semibold rounded-control px-3 py-1.5 transition-colors ${
        active ? "bg-white text-ink shadow-sm" : "text-charcoal-soft"
      }`}
    >
      {children}
    </button>
  );
}
