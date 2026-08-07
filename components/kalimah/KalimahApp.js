"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { recordKalimah } from "@/lib/actions/kalimah";
import { buildQuestions } from "@/lib/kalimah/quiz";

/**
 * Two phases: study the words, then a short recall check.
 *
 * The quiz is built from the ayah's own words — no AI, no authored question
 * bank. Distractors are the other words of the same ayah, which makes the
 * check meaningfully harder than a generic multiple choice (the options are
 * all plausible, related words) while staying entirely grounded in real data.
 */
export default function KalimahApp({ verse, surahName, alreadyDone }) {
  const router = useRouter();
  const [phase, setPhase] = useState("study"); // study | quiz | done
  const [qIndex, setQIndex] = useState(0);
  const [picked, setPicked] = useState(null);
  const [score, setScore] = useState(0);
  const [saving, setSaving] = useState(false);
  const audioRef = useRef(null);

  const questions = useMemo(() => buildQuestions(verse.words), [verse.words]);

  function play(url) {
    if (!url) return;
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => {
      /* autoplay blocked or file missing — silent, the text is the lesson */
    });
  }

  function answer(option) {
    if (picked !== null) return;
    setPicked(option);
    if (option === questions[qIndex].answer) setScore((s) => s + 1);
  }

  async function next() {
    if (qIndex + 1 < questions.length) {
      setQIndex((i) => i + 1);
      setPicked(null);
      return;
    }
    setPhase("done");
    setSaving(true);
    await recordKalimah({ score, total: questions.length, wordsSeen: verse.words.length });
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* The ayah itself */}
      <div className="rounded-card border border-line bg-white p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="rounded-pill bg-sand px-2.5 py-1 text-[11px] font-bold text-ink">
            {surahName} · {verse.key}
          </span>
          {alreadyDone && (
            <span className="text-[12px] font-semibold text-charcoal-soft">
              Done today · {alreadyDone.score}/{alreadyDone.total}
            </span>
          )}
        </div>
        <p className="font-arabic text-[30px] leading-loose text-ink" dir="rtl">
          {verse.arabic}
        </p>
        {verse.translation && (
          <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-charcoal-soft">
            {verse.translation}
          </p>
        )}
      </div>

      {phase === "study" && (
        <>
          <div className="rounded-card border border-line bg-white p-6">
            <h2 className="mb-1 font-heading text-[17px] font-bold text-charcoal">Word by word</h2>
            <p className="mb-4 text-[13px] text-charcoal-soft">
              Tap any word to hear it. Word meanings are English; the full ayah above is in Malay.
            </p>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {verse.words.map((w) => (
                <li key={w.position}>
                  <button
                    type="button"
                    onClick={() => play(w.audio)}
                    className="flex w-full items-center gap-3 rounded-control bg-paper px-4 py-3 text-left transition-colors hover:bg-paper-deep"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-arabic text-[24px] leading-snug text-ink" dir="rtl">
                        {w.arabic}
                      </span>
                      <span className="mt-0.5 block text-[12px] italic text-charcoal-soft">
                        {w.transliteration}
                      </span>
                      <span className="mt-0.5 block text-[13px] font-semibold text-charcoal">
                        {w.meaning}
                      </span>
                    </span>
                    {w.audio && (
                      <span className="flex-shrink-0 text-gold">
                        <Icon name="play" size={16} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {questions.length > 0 ? (
            <button
              type="button"
              onClick={() => setPhase("quiz")}
              className="flex items-center gap-2 rounded-control bg-ink px-5 py-2.5 text-[14px] font-bold text-paper shadow-[0_4px_12px_rgba(64,53,72,0.24)] transition-colors hover:bg-ink-deep"
            >
              <Icon name="check" size={16} />
              Check what I remember
            </button>
          ) : (
            <p className="text-[12px] text-charcoal-soft">
              This ayah has too few distinct words for a recall check — just study them today.
            </p>
          )}
        </>
      )}

      {phase === "quiz" && (
        <div className="rounded-card border border-line bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">
              Question {qIndex + 1} of {questions.length}
            </span>
            <span className="text-[12px] font-semibold text-charcoal-soft">{score} correct</span>
          </div>

          <p className="mb-1 text-[13px] text-charcoal-soft">What does this word mean?</p>
          <p className="mb-5 font-arabic text-[36px] leading-snug text-ink" dir="rtl">
            {questions[qIndex].word}
          </p>

          <ul className="space-y-2">
            {questions[qIndex].options.map((opt) => {
              const isAnswer = opt === questions[qIndex].answer;
              const chosen = picked === opt;
              const reveal = picked !== null;
              return (
                <li key={opt}>
                  <button
                    type="button"
                    onClick={() => answer(opt)}
                    disabled={reveal}
                    className={`flex w-full items-center justify-between gap-2 rounded-control px-4 py-3 text-left text-[14px] transition-colors ${
                      reveal && isAnswer
                        ? "bg-[#E4F0E4] font-semibold text-[#2E6B3E] ring-1 ring-[#8FBF9A]"
                        : reveal && chosen
                          ? "bg-rust-soft text-[#8E3D52] ring-1 ring-[#F2D8E1]"
                          : "bg-paper text-charcoal hover:bg-paper-deep"
                    } ${reveal ? "cursor-default" : ""}`}
                  >
                    {opt}
                    {reveal && isAnswer && <Icon name="check" size={16} />}
                    {reveal && chosen && !isAnswer && <Icon name="x" size={16} />}
                  </button>
                </li>
              );
            })}
          </ul>

          {picked !== null && (
            <button
              type="button"
              onClick={next}
              className="mt-5 rounded-control bg-ink px-5 py-2.5 text-[14px] font-bold text-paper transition-opacity hover:opacity-90"
            >
              {qIndex + 1 < questions.length ? "Next" : "Finish"}
            </button>
          )}
        </div>
      )}

      {phase === "done" && (
        <div className="rounded-card border border-line bg-gradient-to-br from-white to-[#FDF3F7] p-8 text-center">
          <span className="mx-auto mb-3 block w-fit text-gold">
            <Icon name="sparkles" size={28} />
          </span>
          <p className="font-heading text-[22px] font-bold text-charcoal">
            {score} out of {questions.length}
          </p>
          <p className="mt-1 text-[13px] text-charcoal-soft">
            {saving
              ? "Saving…"
              : score === questions.length
                ? "Every one right. See you tomorrow, insyaAllah."
                : "Good — the words you missed will come round again."}
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase("study");
              setQIndex(0);
              setPicked(null);
              setScore(0);
            }}
            className="mt-5 rounded-control bg-white px-4 py-2 text-[13px] font-semibold text-charcoal ring-1 ring-line transition-colors hover:bg-paper-deep"
          >
            Study again
          </button>
        </div>
      )}
    </div>
  );
}
