"use client";

import { useState, useTransition } from "react";
import { updateReadingEntry, deleteReadingEntry } from "@/lib/actions/reading";
import { formatDateTime } from "@/lib/date";
import Icon from "@/components/Icon";
import EmptyArt from "@/components/EmptyArt";

function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function localInputToIso(local) {
  const t = Date.parse(local);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

function label(entry) {
  if (entry.entry_type === "session") return `Reading session · ${entry.session_minutes} minutes`;
  const ayah = entry.verse_key ? entry.verse_key.split(":")[1] : null;
  return ayah ? `Last read · ${entry.surah_name} · Ayah ${ayah}` : `Last read · ${entry.surah_name}`;
}

export default function ReadingHistory({ entries }) {
  if (!entries.length) {
    return <EmptyArt art="reading">No reading entries yet — log one above.</EmptyArt>;
  }
  return (
    <ul>
      {entries.map((entry) => (
        <Row key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

function Row({ entry }) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() => isoToLocalInput(entry.read_at || entry.created_at));
  const [pending, startTransition] = useTransition();

  function save() {
    const iso = localInputToIso(when);
    if (!iso) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", entry.id);
      fd.set("read_at", iso);
      await updateReadingEntry(fd);
      setEditing(false);
    });
  }

  function remove() {
    startTransition(async () => {
      await deleteReadingEntry(entry.id);
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 py-2.5 border-b-[0.5px] border-line last:border-0">
      <div className="min-w-0 flex-1 text-[13px] font-medium text-charcoal">{label(entry)}</div>

      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="bg-paper border-[0.5px] border-line rounded-control px-2 py-1 text-[12px] text-charcoal outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-control bg-ink px-3 py-1 text-[12px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setWhen(isoToLocalInput(entry.read_at || entry.created_at));
              setEditing(false);
            }}
            className="text-[12px] text-charcoal-soft hover:text-charcoal"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-charcoal-soft tabular-nums">
            {formatDateTime(entry.read_at || entry.created_at)}
          </span>
          <button
            type="button"
            aria-label="Edit date and time"
            title="Edit date and time"
            onClick={() => setEditing(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-charcoal-soft transition-colors hover:bg-paper-deep hover:text-charcoal"
          >
            <Icon name="pencil" size={14} />
          </button>
          <button
            type="button"
            aria-label="Delete entry"
            title="Delete entry"
            onClick={remove}
            disabled={pending}
            className="flex h-7 w-7 items-center justify-center rounded-full text-charcoal-soft transition-colors hover:bg-rust-soft hover:text-rust disabled:opacity-60"
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      )}
    </li>
  );
}
