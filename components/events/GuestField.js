"use client";

import { useRef, useState } from "react";
import { fieldIsMultiple } from "@/lib/events/fields";
import { downscale, MAX_PICK_BYTES } from "@/lib/events/downscale";

/* One custom question on a guest's invitation.

   Everything here uses the invitation's own .inv-* classes rather than the
   portal's Tailwind, because this renders inside a design Karim generated — a
   custom question has to look like it was always part of the card.

   Every admin-authored string (label, hint, option) is wrapped in <bdi>. These
   are typed once, in one language, and rendered on invitations in three — a
   Latin label ending in "?" reorders to "?Question" on the Arabic page
   without it. Same rule as the venue address on the invitation card. The one
   exception is a native <option>, which may not contain elements.

   Native controls throughout, deliberately: this form is opened on a five-year-
   old Android in a car park, and a hand-built select is a worse experience than
   the one the phone ships with. */
export default function GuestField({ field, value, onChange, t, disabled, onUpload }) {
  const inputId = `cf-${field.id}`;
  const common = { id: inputId, disabled, "aria-required": field.required || undefined };

  const labelBlock = (
    <label className="inv-label" htmlFor={inputId}>
      <bdi>{field.label}</bdi>
      {!field.required ? <span className="inv-optional"> · {t("optional")}</span> : null}
      {field.hint ? <span className="inv-hint"><bdi>{field.hint}</bdi></span> : null}
    </label>
  );

  if (field.type === "checkbox") {
    return (
      <div className="inv-field">
        <label className="inv-check">
          <input
            type="checkbox"
            id={inputId}
            disabled={disabled}
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            <bdi>{field.label}</bdi>
            {field.hint ? <span className="inv-hint"><bdi>{field.hint}</bdi></span> : null}
          </span>
        </label>
      </div>
    );
  }

  if (field.type === "multi") {
    const picked = Array.isArray(value) ? value : [];
    return (
      <fieldset className="inv-field inv-fieldset">
        <legend className="inv-label">
          <bdi>{field.label}</bdi>
          {!field.required ? <span className="inv-optional">{` · ${t("optional")}`}</span> : null}
          {field.hint ? <span className="inv-hint"><bdi>{field.hint}</bdi></span> : null}
        </legend>
        {field.options.map((option) => (
          <label key={option} className="inv-check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={picked.includes(option)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...picked, option]
                    : picked.filter((v) => v !== option)
                )
              }
            />
            <span><bdi>{option}</bdi></span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (field.type === "select") {
    return (
      <div className="inv-field">
        {labelBlock}
        <select
          {...common}
          className="inv-select"
          value={fieldIsMultiple(field.type) ? "" : String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className="inv-field">
        {labelBlock}
        <textarea
          {...common}
          className="inv-textarea"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.type === "file") {
    return <FileField field={field} value={value} onChange={onChange} t={t} disabled={disabled} onUpload={onUpload} />;
  }

  // text | number | date | phone | email — all one-line inputs; the type
  // attribute is what summons the right keyboard on a phone, which is most of
  // the value of asking for a typed answer in the first place.
  const typeAttr = {
    number: "number",
    date: "date",
    phone: "tel",
    email: "email",
  }[field.type] || "text";

  return (
    <div className="inv-field">
      {labelBlock}
      <input
        {...common}
        type={typeAttr}
        inputMode={field.type === "phone" ? "tel" : field.type === "number" ? "numeric" : undefined}
        autoComplete={
          field.type === "phone" ? "tel" : field.type === "email" ? "email" : undefined
        }
        className="inv-input"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/* Uploads on pick rather than on submit. The reply must never be held hostage
   by Drive: by the time the guest presses "Send my reply" the file is either
   already up (and the answer is its id) or visibly failed. */
function FileField({ field, value, onChange, t, disabled, onUpload }) {
  const ref = useRef(null);
  const [state, setState] = useState(value ? "done" : "idle");
  const [problem, setProblem] = useState("");

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProblem("");
    if (file.size > MAX_PICK_BYTES) {
      setProblem(t("tooLarge"));
      return;
    }
    try {
      setState("working");
      const dataUrl = await downscale(file);
      const result = await onUpload({ fieldId: field.id, dataUrl });
      if (!result?.ok) {
        setState("failed");
        setProblem(t(result?.error) || t("uploadFailed"));
        return;
      }
      onChange(result.fileId);
      setState("done");
    } catch {
      setState("failed");
      setProblem(t("uploadFailed"));
    }
  }

  return (
    <div className="inv-field">
      <span className="inv-label">
        <bdi>{field.label}</bdi>
        {!field.required ? <span className="inv-optional"> · {t("optional")}</span> : null}
        {field.hint ? <span className="inv-hint"><bdi>{field.hint}</bdi></span> : null}
      </span>

      <div
        className="inv-photo-drop"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && ref.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ref.current?.click();
          }
        }}
      >
        {state === "working"
          ? t("uploading")
          : state === "done"
            ? `✓ ${t("uploaded")} — ${t("changeFile")}`
            : t("chooseFile")}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        disabled={disabled}
        onChange={pick}
      />
      {problem ? <p className="inv-error">{problem}</p> : null}
    </div>
  );
}
