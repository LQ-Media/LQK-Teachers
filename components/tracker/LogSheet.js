"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveLesson } from "@/lib/actions/tracker";
import { ALL_SURAHS, surahByNumber, sabaqLabel, nextPortion } from "@/lib/quran/surah-list";
import { LESSON_GRADES } from "@/lib/tracker/grades";
import Icon from "@/components/Icon";
import { titleCase, sgTodayLabel } from "./util";

export default function LogSheet({ student, teacherName, className, onClose, onSaved }) {
  const start = student.lastRead ? nextPortion(student.lastRead) : { s: 1, f: 1, t: 3 };
  const [qp, setQp] = useState(start);
  const [grade, setGrade] = useState("");
  const [note, setNote] = useState("");
  const [arabic, setArabic] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const shareRef = useRef(null);

  const cap = (surahByNumber(qp.s) || { ayahCount: 1 }).ayahCount;

  function setPicker(s, f, t) {
    const c = (surahByNumber(s) || { ayahCount: 1 }).ayahCount;
    f = Math.min(Math.max(1, f), c);
    t = Math.min(Math.max(f, t), c);
    setQp({ s, f, t });
  }

  // Live Arabic preview of the first ayah in the portion (debounced).
  useEffect(() => {
    const key = `${qp.s}:${qp.f}`;
    let alive = true;
    const timer = setTimeout(() => {
      setArabic("");
      fetch(`https://api.alquran.cloud/v1/ayah/${key}/quran-uthmani`)
        .then((r) => r.json())
        .then((j) => {
          if (alive && j && j.data && j.data.text) setArabic(j.data.text);
        })
        .catch(() => {});
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [qp.s, qp.f]);

  function jumpToJuz(v) {
    if (!v) return;
    fetch(`https://api.alquran.cloud/v1/juz/${v}/quran-uthmani?offset=0&limit=1`)
      .then((r) => r.json())
      .then((j) => {
        const a = j && j.data && j.data.ayahs && j.data.ayahs[0];
        if (!a) throw new Error("no ayah");
        const sn = a.surah.number;
        const ay = a.numberInSurah;
        setPicker(sn, ay, Math.min(ay + 2, surahByNumber(sn).ayahCount));
      })
      .catch(() => setError("Quran service offline — use the surah picker."));
  }

  const label = useMemo(() => sabaqLabel(qp.s, qp.f, qp.t), [qp]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await saveLesson({ studentId: student.id, surah: qp.s, from: qp.f, to: qp.t, grade, note });
      onSaved(res);
      // Best-effort share card; never block the save on it.
      shareLesson().catch(() => {});
      onClose();
    } catch (e) {
      setError(e?.message || "Couldn't save — check your connection.");
      setSaving(false);
    }
  }

  async function shareLesson() {
    const el = shareRef.current;
    if (!el) return;
    let html2canvas;
    try {
      // Loaded at runtime from a CDN (kept out of the bundle) — sharing is a
      // bonus feature, so a load failure just skips it.
      const url = "https://esm.sh/html2canvas@1.4.1";
      html2canvas = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)).default;
    } catch {
      return;
    }
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: null, useCORS: true, logging: false });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const fname = `${titleCase(student.name).replace(/ /g, "_")}_${new Date().toISOString().slice(0, 10)}.png`;
      const file = new File([blob], fname, { type: "image/png" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ title: `Lesson — ${titleCase(student.name)}`, files: [file] }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fname;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
    }, "image/png");
  }

  const selectCls =
    "min-h-[44px] rounded-control border-[0.5px] border-line bg-paper px-3 text-[14px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Log today's lesson"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-[0_-8px_24px_rgba(58,48,38,0.18)]"
      >
        <div className="mx-auto mb-3 h-1.5 w-11 rounded-pill bg-line" />
        <div className="mb-4 flex items-start">
          <div>
            <h2 className="font-heading text-lg font-semibold text-charcoal">{titleCase(student.name)}</h2>
            <p className="text-[12px] text-charcoal-soft">Today’s portion · {className}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-charcoal-soft hover:bg-paper-deep"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {student.lastRead && (
          <div className="mb-4 flex items-center gap-2 rounded-control bg-paper-deep px-3 py-2">
            <span className="text-[12px] text-charcoal-soft">
              Last: {surahByNumber(student.lastRead.s)?.name} {student.lastRead.f}
              {student.lastRead.t > student.lastRead.f ? `–${student.lastRead.t}` : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                const n = nextPortion(student.lastRead);
                setPicker(n.s, n.f, n.t);
              }}
              className="ml-auto inline-flex items-center gap-0.5 rounded-pill bg-white px-3 py-1 text-[11.5px] font-semibold text-ink hover:bg-gold-soft/40"
            >
              Continue <Icon name="chevron-right" size={13} />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <select className={selectCls} aria-label="Jump to Juz" value="" onChange={(e) => jumpToJuz(Number(e.target.value))}>
            <option value="">Jump to Juz…</option>
            {Array.from({ length: 30 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Juz {i + 1}
              </option>
            ))}
          </select>
          <select
            className={selectCls}
            aria-label="Surah"
            value={qp.s}
            onChange={(e) => {
              const s = Number(e.target.value);
              setPicker(s, 1, Math.min(3, surahByNumber(s).ayahCount));
            }}
          >
            {ALL_SURAHS.map((s) => (
              <option key={s.number} value={s.number}>
                {s.number}. {s.name}
              </option>
            ))}
          </select>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-charcoal-soft">
            From ayah
            <select className={selectCls} value={qp.f} onChange={(e) => setPicker(qp.s, Number(e.target.value), Math.max(qp.t, Number(e.target.value)))}>
              {Array.from({ length: cap }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-charcoal-soft">
            To ayah
            <select className={selectCls} value={qp.t} onChange={(e) => setPicker(qp.s, qp.f, Number(e.target.value))}>
              {Array.from({ length: cap }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 rounded-card bg-paper p-3 text-center">
          <div className="text-[13px] font-semibold text-charcoal">{label}</div>
          {arabic && (
            <div className="mt-2 font-arabic text-[24px] leading-[1.9] text-charcoal" dir="rtl" lang="ar">
              {arabic}
            </div>
          )}
        </div>

        <div className="mt-4 text-[11px] font-semibold text-charcoal-soft">Grade</div>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {LESSON_GRADES.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(grade === g ? "" : g)}
              className={`min-h-[44px] rounded-control text-[14px] font-semibold transition-colors ${
                grade === g ? "bg-ink text-paper" : "border-[0.5px] border-line bg-white text-charcoal hover:bg-paper-deep"
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="mt-4 text-[11px] font-semibold text-charcoal-soft">Note to student</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Write a note or comment for the student…"
          className="mt-1.5 w-full rounded-control border-[0.5px] border-line bg-paper px-3 py-2 text-[14px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
        />

        {error && <div className="mt-3 rounded-control bg-rust-soft px-3 py-2 text-[12.5px] text-rust">{error}</div>}

        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="mt-4 min-h-[48px] rounded-control bg-ink text-[15px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save & share lesson"}
        </button>

        {/* Off-screen card captured by html2canvas for sharing with parents. */}
        <div style={{ position: "fixed", left: -9999, top: 0 }} aria-hidden="true">
          <div
            ref={shareRef}
            style={{
              width: 420,
              padding: 28,
              background: "#FBF4E8",
              color: "#3A3026",
              fontFamily: "system-ui, sans-serif",
              borderRadius: 20,
            }}
          >
            <div style={{ fontSize: 12, letterSpacing: 2, color: "#A8742A", fontWeight: 700 }}>LITTLE QURAN KIDS</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{titleCase(student.name)}</div>
            <div style={{ fontSize: 13, color: "#7A6E5C", marginTop: 2 }}>{sgTodayLabel()}</div>
            <div style={{ height: 1, background: "#E8D9BE", margin: "16px 0" }} />
            <div style={{ fontSize: 12, color: "#7A6E5C" }}>Today’s portion</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{label}</div>
            {grade && (
              <div style={{ marginTop: 12, display: "inline-block", background: "#DFC591", color: "#3A3026", borderRadius: 999, padding: "4px 14px", fontSize: 14, fontWeight: 700 }}>
                {grade}
              </div>
            )}
            {note && <div style={{ marginTop: 14, fontSize: 14, color: "#3A3026" }}>{note}</div>}
            <div style={{ marginTop: 18, fontSize: 11, color: "#7A6E5C" }}>Teacher: {teacherName}</div>
          </div>
        </div>
      </div>
    </>
  );
}
