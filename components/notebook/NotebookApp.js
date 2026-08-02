"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { createNote } from "@/lib/actions/notes";

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

const MODES = [
  { key: "recording", label: "Record", icon: "mic", need: "transcribe" },
  { key: "photo", label: "Photo", icon: "camera", need: "vision" },
  { key: "typed", label: "Type", icon: "type", need: null },
];

const LANGUAGES = [
  { code: "ms", label: "Malay" },
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
  { code: "auto", label: "Detect" },
];

/** Pick a container the browser can actually record. Safari only does mp4. */
function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((c) => MediaRecorder.isTypeSupported?.(c)) ?? "";
}

function extFor(mime) {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function NotebookApp({ capabilities, today }) {
  const router = useRouter();

  const [mode, setMode] = useState(() => (capabilities.transcribe ? "recording" : "typed"));
  const [phase, setPhase] = useState("idle"); // idle | recording | working | review
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState("");

  const [text, setText] = useState("");
  const [language, setLanguage] = useState("ms");
  const [title, setTitle] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [venue, setVenue] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [saving, setSaving] = useState(false);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const tickRef = useRef(null);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  useEffect(() => releaseMic, [releaseMic]);

  async function startRecording() {
    setError(null);
    const mime = pickMime();
    if (mime === null) {
      setError("This browser cannot record audio. Try Chrome or Safari, or use Type instead.");
      return;
    }

    // Browsers only expose mediaDevices in a secure context. Opening the portal
    // over plain http:// on a LAN address (e.g. from a phone at the centre)
    // leaves it undefined, which would otherwise surface as a misleading
    // "microphone was blocked" — the mic was never asked for.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        window.isSecureContext
          ? "This browser doesn't support recording. Try Chrome or Safari, or use Type instead."
          : "Recording needs a secure connection. Open the portal over https:// (or on localhost) — on a plain http:// address the browser blocks microphone access entirely."
      );
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      // NotAllowedError = the teacher denied (or previously denied) the prompt.
      // NotFoundError = there is no microphone at all.
      setError(
        err?.name === "NotFoundError"
          ? "No microphone was found on this device."
          : "Microphone access was blocked. Allow it for this site in your browser settings, then try again."
      );
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    setBytes(0);
    setElapsed(0);

    // ~32kbps mono keeps a 90-minute talk inside the 24MB upload ceiling
    // while staying well above what speech recognition needs.
    const recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      audioBitsPerSecond: 32000,
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (!e.data?.size) return;
      chunksRef.current.push(e.data);
      setBytes((b) => b + e.data.size);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      releaseMic();
      void sendAudio(blob, recorder.mimeType || "audio/webm");
    };

    recorder.start(5000); // flush every 5s so the size read-out stays live
    setPhase("recording");
    tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }

  function stopRecording() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
  }

  function cancelRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    releaseMic();
    chunksRef.current = [];
    setPhase("idle");
    setElapsed(0);
    setBytes(0);
  }

  async function sendAudio(blob, mime) {
    if (blob.size > MAX_AUDIO_BYTES) {
      setError("That recording is too long to send in one piece. Record in shorter sittings — under about 90 minutes each.");
      setPhase("idle");
      return;
    }
    setPhase("working");
    setWorking("Transcribing your recording…");
    const body = new FormData();
    body.set("kind", "audio");
    body.set("language", language);
    body.set("file", blob, `kuliah.${extFor(mime)}`);
    await ingest(body);
  }

  async function onPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setPhase("working");
    setWorking("Reading the page…");
    const body = new FormData();
    body.set("kind", "image");
    body.set("file", file, file.name || "page.jpg");
    await ingest(body);
  }

  async function ingest(body) {
    try {
      const res = await fetch("/api/notebook/ingest", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        setError(data?.error || "That didn't work. Please try again.");
        setPhase("idle");
        return;
      }
      // Appending (not replacing) lets a teacher stack several photos of the
      // same handout, or add a recording on top of notes they already typed.
      setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${data.text}` : data.text));
      setPhase("review");
    } catch {
      setError("The upload failed. Check your connection and try again.");
      setPhase("idle");
    }
  }

  async function onSave(summarise) {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.set("raw_text", text);
    fd.set("source", mode);
    fd.set("title", title);
    fd.set("speaker", speaker);
    fd.set("venue", venue);
    fd.set("occurred_on", occurredOn);
    fd.set("language", language);
    fd.set("summarise", summarise && capabilities.summarise ? "1" : "0");

    const result = await createNote(fd);
    if (!result?.ok) {
      setError(result?.error || "Could not save that note.");
      setSaving(false);
      return;
    }
    router.push(`/notebook/${result.id}${result.warning ? "?warn=1" : ""}`);
  }

  const modeAvailable = (key) => {
    const m = MODES.find((x) => x.key === key);
    return !m?.need || Boolean(capabilities[m.need]);
  };

  const canReview = text.trim().length > 0;
  const nearLimit = bytes > MAX_AUDIO_BYTES * 0.8;

  return (
    <div className="space-y-6">
      {/* Mode picker */}
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => {
          const available = !m.need || capabilities[m.need];
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              // Only blocked mid-capture. An unconfigured mode stays clickable
              // on purpose: a dead button tells a teacher nothing, so selecting
              // it opens a panel saying exactly what is missing and who fixes it.
              disabled={phase === "recording" || phase === "working"}
              onClick={() => setMode(m.key)}
              title={available ? undefined : `${m.label} isn't switched on yet — tap to see why`}
              className={`flex items-center gap-2 rounded-pill px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-40 ${
                active
                  ? "bg-ink text-paper"
                  : available
                    ? "bg-white text-charcoal ring-1 ring-line hover:bg-paper-deep"
                    : "bg-paper-deep text-charcoal-soft hover:bg-sand/40"
              }`}
            >
              <Icon name={m.icon} size={15} />
              {m.label}
              {!available && (
                <span
                  className={`rounded-pill px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    active ? "bg-paper/20 text-paper" : "bg-white text-charcoal-soft"
                  }`}
                >
                  off
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-control bg-rust-soft px-4 py-3 text-[13px] text-[#8A4030]">
          <span className="mt-0.5 flex-shrink-0">
            <Icon name="alert-triangle" size={16} />
          </span>
          <p>{error}</p>
        </div>
      )}

      {/* Capture surface */}
      <div className="rounded-card border border-line bg-white p-6 shadow-[0_1px_3px_rgba(51,58,34,0.04)]">
        {phase === "working" ? (
          <Working label={working} />
        ) : !modeAvailable(mode) ? (
          <UnavailablePane mode={mode} onUseTyping={() => setMode("typed")} />
        ) : mode === "recording" ? (
          <RecordPane
            phase={phase}
            elapsed={elapsed}
            bytes={bytes}
            nearLimit={nearLimit}
            language={language}
            setLanguage={setLanguage}
            onStart={startRecording}
            onStop={stopRecording}
            onCancel={cancelRecording}
          />
        ) : mode === "photo" ? (
          <PhotoPane onPick={onPhoto} hasText={canReview} />
        ) : (
          <TypePane />
        )}
      </div>

      {/* Review + save */}
      {(canReview || mode === "typed") && phase !== "working" && phase !== "recording" && (
        <div className="rounded-card border border-line bg-white p-6 shadow-[0_1px_3px_rgba(51,58,34,0.04)]">
          <h2 className="font-heading text-[17px] font-bold text-charcoal">
            {mode === "typed" ? "Your note" : "Check the text"}
          </h2>
          <p className="mt-1 mb-4 text-[13px] text-charcoal-soft">
            {mode === "typed"
              ? "Write your notes here. You can tidy them into a summary afterwards."
              : "This is what came back. Fix anything that was misheard before you save — the summary is built from this text."}
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder="What was the talk about?"
            className="w-full resize-y rounded-control border border-line bg-paper px-4 py-3 text-[14px] leading-relaxed text-charcoal outline-none focus:border-gold"
          />

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Title" hint="Leave blank to have one written for you">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
              />
            </Field>
            <Field label="Speaker" hint="Always credit whoever gave the talk">
              <input
                value={speaker}
                onChange={(e) => setSpeaker(e.target.value)}
                placeholder="e.g. Ustaz Ahmad"
                className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
              />
            </Field>
            <Field label="Where">
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. Masjid Al-Istiqamah"
                className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
              />
            </Field>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canReview || saving}
              onClick={() => onSave(true)}
              className="flex items-center gap-2 rounded-control bg-gold px-5 py-2.5 text-[14px] font-bold text-ink shadow-[0_4px_12px_rgba(224,169,59,0.35)] transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="sparkles" size={16} />
              {saving ? "Saving…" : capabilities.summarise ? "Summarise & save" : "Save note"}
            </button>
            {capabilities.summarise && (
              <button
                type="button"
                disabled={!canReview || saving}
                onClick={() => onSave(false)}
                className="rounded-control px-4 py-2.5 text-[13px] font-semibold text-charcoal-soft transition-colors hover:bg-paper-deep disabled:opacity-50"
              >
                Save without summarising
              </button>
            )}
          </div>

          {!capabilities.summarise && (
            <p className="mt-3 text-[12px] text-charcoal-soft">
              Summarising isn&apos;t switched on for this server yet — your note will be saved as written.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RecordPane({ phase, elapsed, bytes, nearLimit, language, setLanguage, onStart, onStop, onCancel }) {
  const recording = phase === "recording";
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <button
        type="button"
        onClick={recording ? onStop : onStart}
        className={`flex h-24 w-24 items-center justify-center rounded-full transition-transform hover:scale-105 ${
          recording
            ? "bg-rust text-white shadow-[0_0_0_10px_rgba(181,87,60,0.12)]"
            : "bg-gold text-ink shadow-[0_6px_20px_rgba(224,169,59,0.4)]"
        }`}
        aria-label={recording ? "Stop recording" : "Start recording"}
      >
        <Icon name={recording ? "square" : "mic"} size={34} filled={recording} />
      </button>

      <p className="mt-5 font-heading text-[26px] font-bold tabular-nums text-charcoal">{clock(elapsed)}</p>
      <p className="mt-1 text-[13px] text-charcoal-soft">
        {recording
          ? `Listening… ${(bytes / 1024 / 1024).toFixed(1)}MB`
          : "Tap to start recording the kuliah"}
      </p>

      {nearLimit && recording && (
        <p className="mt-3 max-w-sm rounded-control bg-gold-soft px-3 py-2 text-[12px] text-ink">
          Getting close to the size limit. Stop soon and start a second recording to be safe.
        </p>
      )}

      {recording ? (
        <button
          type="button"
          onClick={onCancel}
          className="mt-5 rounded-control px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:bg-paper-deep"
        >
          Discard
        </button>
      ) : (
        <div className="mt-6 flex items-center gap-2">
          <span className="text-[12px] font-semibold text-charcoal-soft">Mainly spoken in</span>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLanguage(l.code)}
              className={`rounded-pill px-3 py-1 text-[12px] font-semibold transition-colors ${
                language === l.code ? "bg-ink text-paper" : "bg-paper-deep text-charcoal hover:bg-sand/50"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <p className="mt-5 max-w-md text-[12px] leading-relaxed text-charcoal-soft">
        The audio is transcribed and then discarded — nothing is stored. Please record only for your own
        notes, and credit the speaker.
      </p>
    </div>
  );
}

function PhotoPane({ onPick, hasText }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <label className="flex cursor-pointer flex-col items-center gap-3 rounded-card border-2 border-dashed border-line px-10 py-8 transition-colors hover:border-gold hover:bg-paper">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gold-soft text-ink">
          <Icon name="camera" size={26} />
        </span>
        <span className="font-heading text-[15px] font-bold text-charcoal">
          {hasText ? "Add another page" : "Photograph a page"}
        </span>
        <span className="max-w-xs text-[12px] leading-relaxed text-charcoal-soft">
          Works well on printed pages, handouts and slides. Handwriting — especially Arabic
          handwriting — is often misread, so check the text afterwards.
        </span>
        <input type="file" accept="image/*" capture="environment" onChange={onPick} className="sr-only" />
      </label>
    </div>
  );
}

/**
 * Shown when a capture mode has no provider key on the server.
 *
 * Says which key is missing and who can add it, because the two audiences who
 * hit this need different things: a teacher needs to know it isn't their fault
 * and what to do instead, an admin needs the exact variable name.
 */
function UnavailablePane({ mode, onUseTyping }) {
  const copy =
    mode === "recording"
      ? {
          icon: "mic",
          title: "Recording isn't switched on yet",
          body: "This server has no transcription key, so recordings can't be turned into text.",
          envVar: "GROQ_API_KEY",
          where: "console.groq.com/keys",
          note: "It's free, and the same key also writes the summaries.",
        }
      : {
          icon: "camera",
          title: "Photo capture isn't switched on yet",
          body: "This server has no image key, so text can't be read out of a photograph.",
          envVar: "GEMINI_API_KEY",
          where: "aistudio.google.com/apikey",
          note: "Optional and free — only this Photo mode needs it.",
        };

  return (
    <div className="py-4 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-paper-deep text-charcoal-soft">
        <Icon name={copy.icon} size={24} />
      </span>
      <p className="mt-4 font-heading text-[16px] font-bold text-charcoal">{copy.title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-charcoal-soft">{copy.body}</p>

      <div className="mx-auto mt-5 max-w-md rounded-control bg-paper px-4 py-3 text-left">
        <p className="text-[11px] font-bold uppercase tracking-wide text-charcoal-soft">For an admin</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-charcoal">
          Add <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px]">{copy.envVar}</code>{" "}
          to the server&apos;s environment, then restart it. Get a key from{" "}
          <span className="font-semibold">{copy.where}</span>.
        </p>
        <p className="mt-1.5 text-[12px] text-charcoal-soft">{copy.note}</p>
      </div>

      <button
        type="button"
        onClick={onUseTyping}
        className="mt-5 rounded-control bg-ink px-5 py-2.5 text-[13px] font-bold text-paper transition-opacity hover:opacity-90"
      >
        Type notes instead
      </button>
    </div>
  );
}

function TypePane() {
  return (
    <div className="flex items-start gap-3 py-1 text-[13px] text-charcoal-soft">
      <span className="mt-0.5 flex-shrink-0 text-gold">
        <Icon name="type" size={18} />
      </span>
      <p className="leading-relaxed">
        Type or paste your notes below. When you save, they&apos;ll be tidied into key points, references
        and class ideas.
      </p>
    </div>
  );
}

function Working({ label }) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-line border-t-gold" />
      <p className="font-heading text-[15px] font-bold text-charcoal">{label}</p>
      <p className="max-w-xs text-[12px] text-charcoal-soft">
        A long talk can take up to a minute. Please keep this page open.
      </p>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-charcoal-soft">{hint}</span>}
    </label>
  );
}
