"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { previewCsv, saveContactList } from "@/lib/actions/events";

const FIELDS = [
  { key: "name", label: "Parent name", hint: "Used to address the email — optional but nicer." },
  { key: "email", label: "Email", hint: "Needed to send by email." },
  { key: "phone", label: "WhatsApp number", hint: "Needed to send by WhatsApp." },
  { key: "child_name", label: "Child's name", hint: "Optional." },
];

/**
 * Two-step CSV import: read the file and show what we found, then store it
 * once the operator has confirmed (or corrected) the column mapping.
 *
 * The confirm step exists because auto-detection is a guess. Silently mapping
 * "Contact" to the phone column when it held an email would send the whole
 * cohort's invites into the void, and nobody would know until the day of the
 * event.
 */
export default function ContactListImport({ onDone, onCancel }) {
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [listName, setListName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);

    const fd = new FormData();
    fd.set("file", file);
    const res = await previewCsv(fd);
    setBusy(false);

    if (res?.error) {
      setError(res.error);
      return;
    }
    setPreview(res);
    setMapping(res.mapping);
    setListName(res.fileName?.replace(/\.csv$/i, "") || "Parent list");
  }

  // Recount as the operator remaps, so the "will import N" figure is always
  // about the mapping currently on screen.
  function setField(field, index) {
    setMapping((m) => ({ ...m, [field]: Number(index) }));
  }

  async function onSave() {
    setBusy(true);
    setError("");
    const res = await saveContactList({
      name: listName,
      sourceName: preview.fileName,
      rows: preview.rows,
      mapping,
      hasHeader: preview.hasHeader,
    });
    setBusy(false);

    if (res?.error) {
      setError(res.error);
      return;
    }
    setResult(res);
    onDone?.();
  }

  const headers = preview?.headers || [];

  return (
    <div className="mt-3 rounded-card border border-line bg-white p-4">
      {!preview ? (
        <>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-control border border-dashed border-line bg-paper px-4 py-8 text-center hover:bg-paper-deep">
            <Icon name="upload" size={22} />
            <span className="text-[14px] font-bold text-charcoal">Choose a CSV file</span>
            <span className="max-w-md text-[12px] leading-relaxed text-charcoal-soft">
              Any export works — I&apos;ll look for the name, email and WhatsApp columns and show you what I found before
              anything is saved. Singapore numbers can be plain 8-digit ones; I&apos;ll add the +65.
            </span>
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" disabled={busy} />
          </label>
          {busy ? <p className="mt-2 text-center text-[12px] text-charcoal-soft">Reading…</p> : null}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14px] font-bold text-charcoal">{preview.fileName}</p>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setMapping(null);
              }}
              className="text-[12px] text-charcoal-soft underline"
            >
              Choose a different file
            </button>
          </div>

          <div className="mt-3">
            <label htmlFor="list-name" className="text-[12px] font-bold text-charcoal-soft">
              Name this list
            </label>
            <input
              id="list-name"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              className="mt-1 w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
            />
          </div>

          <div className="mt-4">
            <p className="text-[12px] font-bold text-charcoal-soft">Which column is which?</p>
            <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
              {FIELDS.map((field) => (
                <div key={field.key}>
                  <label htmlFor={`map-${field.key}`} className="text-[12px] text-charcoal">
                    {field.label}
                  </label>
                  <select
                    id={`map-${field.key}`}
                    value={mapping?.[field.key] ?? -1}
                    onChange={(e) => setField(field.key, e.target.value)}
                    className="mt-1 w-full rounded-control border border-line bg-paper px-2.5 py-2 text-[13px] outline-none focus:border-gold"
                  >
                    <option value={-1}>— not in this file —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {preview.hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                  <p className="mt-0.5 text-[11px] text-charcoal-soft">{field.hint}</p>
                </div>
              ))}
            </div>
          </div>

          {preview.sampleRows?.length ? (
            <div className="mt-4 overflow-x-auto">
              <p className="text-[12px] font-bold text-charcoal-soft">First few rows</p>
              <table className="mt-1.5 w-full min-w-[420px] text-left text-[12px]">
                <tbody>
                  {preview.sampleRows.map((row, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      {row.map((cell, j) => (
                        <td key={j} className="max-w-[180px] truncate py-1.5 pr-3 text-charcoal-soft">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="mt-4 rounded-control bg-paper-deep px-3 py-2.5">
            <p className="text-[13px] text-charcoal">
              <strong>{preview.contactCount}</strong> parent{preview.contactCount === 1 ? "" : "s"} will be imported
              {preview.skippedCount ? (
                <>
                  {" "}
                  · <strong>{preview.skippedCount}</strong> row{preview.skippedCount === 1 ? "" : "s"} skipped
                </>
              ) : null}
            </p>
            {preview.skipped?.length ? (
              <ul className="mt-1.5 space-y-0.5">
                {preview.skipped.map((s, i) => (
                  <li key={i} className="text-[11px] text-charcoal-soft">
                    {s.reason}: <span className="opacity-70">{s.row}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-1.5 text-[11px] text-charcoal-soft">
              Counts are from the mapping detected when the file was read. Change a column above and save — the import
              re-reads the file with your mapping.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="rounded-control bg-ink px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {busy ? "Importing…" : "Import list"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-control border border-line px-4 py-2.5 text-[13px] font-bold text-charcoal-soft hover:bg-paper-deep"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {error ? <p className="mt-3 text-[12px] text-rust">{error}</p> : null}
      {result ? (
        <p className="mt-3 text-[12px] text-charcoal">
          Imported {result.count} parents{result.skippedCount ? ` (${result.skippedCount} skipped)` : ""}.
        </p>
      ) : null}
    </div>
  );
}
