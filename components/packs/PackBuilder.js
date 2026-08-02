"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { AGE_GROUPS } from "@/lib/notes/taxonomy";
import { previewRange, generatePack } from "@/lib/actions/packs";

/**
 * Reviewer-only pack builder.
 *
 * Deliberately two steps: "Check portion" is free (pure mushaf data, no model
 * call) and shows exactly which tajweed rules are in the range, so a reviewer
 * can confirm they picked the right ayat *before* spending a generation.
 */
export default function PackBuilder({ surahs, canGenerate }) {
  const router = useRouter();
  const [surah, setSurah] = useState(1);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(7);
  const [ageGroup, setAgeGroup] = useState("7-9");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const chapter = surahs.find((s) => s.number === Number(surah));
  const maxAyah = chapter?.ayahCount ?? 7;

  function onSurahChange(value) {
    const n = Number(value);
    setSurah(n);
    const cap = surahs.find((s) => s.number === n)?.ayahCount ?? 1;
    setFrom(1);
    setTo(Math.min(7, cap));
    setPreview(null);
  }

  async function onPreview() {
    setBusy("preview");
    setError(null);
    setPreview(null);
    const fd = new FormData();
    fd.set("surah", String(surah));
    fd.set("from_ayah", String(from));
    fd.set("to_ayah", String(to));
    const result = await previewRange(fd);
    setBusy(null);
    if (!result?.ok) {
      setError(result?.error || "Could not read that portion.");
      return;
    }
    setPreview(result.analysis);
  }

  async function onGenerate() {
    setBusy("generate");
    setError(null);
    const fd = new FormData();
    fd.set("surah", String(surah));
    fd.set("from_ayah", String(from));
    fd.set("to_ayah", String(to));
    fd.set("age_group", ageGroup);
    const result = await generatePack(fd);
    setBusy(null);
    if (!result?.ok) {
      setError(result?.error || "Could not build that pack.");
      return;
    }
    router.push(`/packs/${result.id}`);
  }

  return (
    <div className="rounded-card border border-line bg-white p-6 shadow-[0_1px_3px_rgba(51,58,34,0.04)]">
      <h2 className="font-heading text-[17px] font-bold text-charcoal">Build a pack</h2>
      <p className="mt-1 mb-4 text-[13px] text-charcoal-soft">
        Pick a portion and an age group. Checking the portion is free; building the plan uses one
        generation and lands as a draft for you to review.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-control bg-rust-soft px-4 py-3 text-[13px] text-[#8A4030]">
          <span className="mt-0.5 flex-shrink-0">
            <Icon name="alert-triangle" size={16} />
          </span>
          <p>{error}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">
            Surah
          </span>
          <select
            value={surah}
            onChange={(e) => onSurahChange(e.target.value)}
            className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
          >
            {surahs.map((s) => (
              <option key={s.number} value={s.number}>
                {s.number}. {s.name} ({s.ayahCount})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">
            From ayah
          </span>
          <input
            type="number"
            min={1}
            max={maxAyah}
            value={from}
            onChange={(e) => {
              setFrom(Number(e.target.value));
              setPreview(null);
            }}
            className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">
            To ayah
          </span>
          <input
            type="number"
            min={from}
            max={maxAyah}
            value={to}
            onChange={(e) => {
              setTo(Number(e.target.value));
              setPreview(null);
            }}
            className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">
            Age group
          </span>
          <select
            value={ageGroup}
            onChange={(e) => setAgeGroup(e.target.value)}
            className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
          >
            {AGE_GROUPS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {preview && (
        <div className="mt-4 rounded-control bg-paper px-4 py-3">
          <p className="font-heading text-[14px] font-bold text-charcoal">
            {preview.label}
            <span className="ml-2 text-[12px] font-normal text-charcoal-soft">
              {preview.ayahCount} ayah{preview.ayahCount === 1 ? "" : "s"}
            </span>
          </p>
          {preview.rules.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {preview.rules.map((r) => (
                <span
                  key={r.key}
                  className="rounded-pill bg-white px-2.5 py-1 text-[11px] font-semibold text-charcoal ring-1 ring-line"
                >
                  {r.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[12px] text-charcoal-soft">No coloured tajweed rules in this range.</p>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onPreview}
          disabled={busy !== null}
          className="rounded-control bg-white px-4 py-2 text-[13px] font-semibold text-charcoal ring-1 ring-line transition-colors hover:bg-paper-deep disabled:opacity-50"
        >
          {busy === "preview" ? "Checking…" : "Check portion"}
        </button>
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy !== null || !canGenerate}
          title={canGenerate ? undefined : "Pack generation is not configured on this server"}
          className="flex items-center gap-2 rounded-control bg-gold px-5 py-2 text-[13px] font-bold text-ink shadow-[0_4px_12px_rgba(224,169,59,0.35)] transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="sparkles" size={15} />
          {busy === "generate" ? "Building…" : "Build the plan"}
        </button>
      </div>

      {!canGenerate && (
        <p className="mt-3 text-[12px] text-charcoal-soft">
          Building plans needs an AI key on the server. Checking a portion works without one.
        </p>
      )}
    </div>
  );
}
