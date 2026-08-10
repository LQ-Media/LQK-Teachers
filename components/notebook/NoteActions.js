"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { deleteNote, summariseExistingNote } from "@/lib/actions/notes";

export default function NoteActions({ id, canSummarise, hasSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null); // "summarise" | "delete" | null
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  async function onSummarise() {
    setBusy("summarise");
    setError(null);
    const result = await summariseExistingNote(id);
    setBusy(null);
    if (!result?.ok) {
      setError(result?.error || "Could not summarise that right now.");
      return;
    }
    router.refresh();
  }

  async function onDelete() {
    setBusy("delete");
    await deleteNote(id);
    router.push("/notebook");
  }

  return (
    <div className="mt-6">
      {error && (
        <div className="mb-3 flex items-start gap-2.5 rounded-control bg-rust-soft px-4 py-3 text-[13px] text-[#8E3A24]">
          <span className="mt-0.5 flex-shrink-0">
            <Icon name="alert-triangle" size={16} />
          </span>
          <p>{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canSummarise && (
          <button
            type="button"
            onClick={onSummarise}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-control bg-white px-4 py-2 text-[13px] font-semibold text-charcoal ring-1 ring-line transition-colors hover:bg-paper-deep disabled:opacity-50"
          >
            <Icon name={busy === "summarise" ? "refresh" : "sparkles"} size={15} />
            {busy === "summarise"
              ? "Working…"
              : hasSummary
                ? "Summarise again"
                : "Summarise this note"}
          </button>
        )}

        {confirming ? (
          <span className="flex items-center gap-2 text-[13px]">
            <span className="text-charcoal-soft">Delete this note?</span>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy !== null}
              className="rounded-control bg-rust px-3 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === "delete" ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-control px-3 py-2 text-[13px] font-semibold text-charcoal-soft hover:bg-paper-deep"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-control px-3 py-2 text-[13px] font-semibold text-charcoal-soft transition-colors hover:bg-paper-deep disabled:opacity-50"
          >
            <Icon name="trash" size={15} />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
