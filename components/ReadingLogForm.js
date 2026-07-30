"use client";

import { useActionState, useMemo, useState } from "react";
import { logReading } from "@/lib/actions/reading";
import { ALL_SURAHS, surahByNumber } from "@/lib/quran/surah-list";

// datetime-local <-> ISO helpers. The datetime-local value is in the browser's
// local timezone; converting through a Date here (client side) makes it
// unambiguous before it reaches the server.
function nowLocalInputValue() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function localInputToIso(local) {
  if (!local) return "";
  const t = Date.parse(local);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

const field =
  "bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

export default function ReadingLogForm() {
  const [tab, setTab] = useState("surah");
  const [surahNum, setSurahNum] = useState("");
  // Prefilled with "now"; the browser's local time is authoritative, so we
  // suppress the SSR/client attribute diff on the input below.
  const [when, setWhen] = useState(() => nowLocalInputValue());

  const maxAyah = useMemo(() => surahByNumber(surahNum)?.ayahCount ?? 286, [surahNum]);

  const [, formAction, pending] = useActionState(async (_prev, formData) => {
    // Fold the local ayah + when fields into what the action expects.
    formData.set("read_at", localInputToIso(String(formData.get("read_at_local") || "")));
    if (tab === "surah") {
      const s = Number(formData.get("surah_number"));
      const a = Number(formData.get("ayah"));
      if (s && a) formData.set("verse_key", `${s}:${a}`);
    }
    await logReading(formData);
    return null;
  }, null);

  return (
    <div className="bg-white border-[0.5px] border-line rounded-card p-5">
      <div className="flex gap-1 mb-4 bg-paper-deep rounded-control p-1 w-fit">
        <TabButton active={tab === "surah"} onClick={() => setTab("surah")}>
          Last read
        </TabButton>
        <TabButton active={tab === "session"} onClick={() => setTab("session")}>
          Reading session
        </TabButton>
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="entry_type" value={tab} />

        {tab === "surah" ? (
          <>
            <div className="flex flex-col gap-1.5 min-w-[180px] flex-1">
              <label className="text-[11px] font-semibold text-charcoal-soft">Surah</label>
              <select
                name="surah_number"
                required
                value={surahNum}
                onChange={(e) => setSurahNum(e.target.value)}
                className={field}
              >
                <option value="" disabled>
                  Select a surah
                </option>
                {ALL_SURAHS.map((s) => (
                  <option key={s.number} value={s.number}>
                    {s.number}. {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 w-[92px]">
              <label className="text-[11px] font-semibold text-charcoal-soft">Ayah</label>
              <input
                type="number"
                name="ayah"
                min="1"
                max={maxAyah}
                placeholder="optional"
                className={field}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5 w-[140px]">
            <label className="text-[11px] font-semibold text-charcoal-soft">Minutes</label>
            <input type="number" name="session_minutes" min="1" required placeholder="e.g. 20" className={field} />
          </div>
        )}

        <div className="flex flex-col gap-1.5 min-w-[190px]">
          <label className="text-[11px] font-semibold text-charcoal-soft">When</label>
          <input
            type="datetime-local"
            name="read_at_local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            suppressHydrationWarning
            className={field}
          />
        </div>

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
