"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { approvePack, unapprovePack, deletePack } from "@/lib/actions/packs";

/** Reviewer controls at the foot of a pack. */
export default function PackReview({ id, status }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [confirming, setConfirming] = useState(false);

  async function run(kind, fn) {
    setBusy(kind);
    await fn(id);
    setBusy(null);
    if (kind === "delete") router.push("/packs");
    else router.refresh();
  }

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5">
      {status === "draft" ? (
        <button
          type="button"
          onClick={() => run("approve", approvePack)}
          disabled={busy !== null}
          className="flex items-center gap-2 rounded-control bg-gold px-5 py-2.5 text-[13px] font-bold text-ink shadow-[0_4px_12px_rgba(224,169,59,0.35)] transition-colors hover:bg-gold-hover disabled:opacity-50"
        >
          <Icon name="check" size={15} />
          {busy === "approve" ? "Approving…" : "Approve for teachers"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => run("unapprove", unapprovePack)}
          disabled={busy !== null}
          className="rounded-control bg-white px-4 py-2.5 text-[13px] font-semibold text-charcoal ring-1 ring-line transition-colors hover:bg-paper-deep disabled:opacity-50"
        >
          {busy === "unapprove" ? "Working…" : "Send back to draft"}
        </button>
      )}

      {confirming ? (
        <span className="flex items-center gap-2 text-[13px]">
          <span className="text-charcoal-soft">Delete this pack?</span>
          <button
            type="button"
            onClick={() => run("delete", deletePack)}
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
          className="flex items-center gap-2 rounded-control px-3 py-2.5 text-[13px] font-semibold text-charcoal-soft transition-colors hover:bg-paper-deep disabled:opacity-50"
        >
          <Icon name="trash" size={15} />
          Delete
        </button>
      )}
    </div>
  );
}
