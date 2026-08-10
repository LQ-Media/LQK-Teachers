"use client";

import { useRef, useState } from "react";
import { t as translate, formatDeadline } from "@/lib/events/i18n";
import { submitRsvp, uploadFamilyPhoto } from "./actions";

/* The RSVP block.

   One client component rather than several so the "attending" choice can drive
   what the rest of the form shows without prop-drilling or a store — declining
   guests should never be asked how many children they're bringing.

   Photos are downscaled IN THE BROWSER before upload. Not an optimisation: a
   Next.js Server Action body defaults to a 1MB cap, phone photos are 2–8MB, and
   the failure mode is a 500 mid-submit that looks to the guest like the whole
   RSVP broke. Re-encoding to a 1400px JPEG also strips EXIF, so we aren't
   quietly collecting the GPS coordinates of guests' homes. */

const MAX_EDGE = 1400;
const QUALITY = 0.82;

async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", QUALITY);
}

function Stepper({ label, value, onChange, min = 0, max = 20 }) {
  return (
    <div className="inv-stepper">
      <span className="inv-stepper-label">{label}</span>
      <div className="inv-stepper-controls">
        <button
          type="button"
          className="inv-step-btn"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`${label} −`}
        >
          −
        </button>
        {/* aria-live so a screen reader announces the new count on change —
            otherwise pressing + is silent and the value is invisible. */}
        <span className="inv-step-value" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="inv-step-btn"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`${label} +`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function RsvpForm({ token, lang, event, guest, rsvp }) {
  const t = translate(lang);
  const fileRef = useRef(null);

  const [attending, setAttending] = useState(rsvp?.attending || "");
  const [adults, setAdults] = useState(rsvp?.adults ?? 1);
  const [children, setChildren] = useState(rsvp?.children ?? 0);
  const [extraNames, setExtraNames] = useState(rsvp?.extra_names || "");
  const [dietary, setDietary] = useState(rsvp?.dietary || "");
  const [message, setMessage] = useState(rsvp?.message || "");
  const [familyName, setFamilyName] = useState(guest.family_name || "");
  const [photoConsent, setPhotoConsent] = useState(!!rsvp?.photo_consent);
  const [preview, setPreview] = useState(null);
  const [photoState, setPhotoState] = useState(rsvp?.photo_drive_id ? "done" : "idle");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(!!rsvp);
  const [editing, setEditing] = useState(!rsvp);

  const cap = event.max_party_size || 10;

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > 25 * 1024 * 1024) {
      setError(t("tooLarge"));
      return;
    }
    try {
      setPhotoState("working");
      const dataUrl = await downscale(file);
      setPreview(dataUrl);
      setPhotoState("ready");
    } catch {
      setPhotoState("idle");
      setError(t("error"));
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!attending) {
      setError(t("required"));
      return;
    }
    setSaving(true);
    setError("");

    const result = await submitRsvp(token, {
      attending,
      adults,
      children,
      extraNames,
      dietary,
      message,
      photoConsent,
    });

    if (!result.ok) {
      setSaving(false);
      setError(t(result.error) || t("error"));
      return;
    }

    // The reply is committed. A photo failure from here on is reported on its
    // own line and never reverts the RSVP the guest just made.
    if (preview && photoState === "ready") {
      const up = await uploadFamilyPhoto(token, { dataUrl: preview, familyName });
      setPhotoState(up.ok ? "done" : "failed");
    }

    setSaving(false);
    setDone(true);
    setEditing(false);
  }

  if (done && !editing) {
    const thanks =
      attending === "yes" ? t("thanksYes") : attending === "no" ? t("thanksNo") : t("thanksMaybe");
    return (
      <div className="inv-card inv-rise inv-rsvp-block">
        <p className="inv-status">{thanks}</p>
        <p className="inv-note" style={{ marginBottom: 10 }}>
          {t("youReplied")}:{" "}
          <strong>{attending === "yes" ? t("yes") : attending === "no" ? t("no") : t("maybe")}</strong>
          {attending === "yes" ? ` · ${adults + children} ${t("guestsCount")}` : ""}
        </p>
        {photoState === "failed" ? <p className="inv-error">{t("error")}</p> : null}
        <div className="inv-actions">
          <button type="button" className="inv-btn-link" onClick={() => setEditing(true)}>
            {t("changeReply")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="inv-card inv-rise inv-rsvp-block" onSubmit={onSubmit} noValidate>
      <h2 className="inv-section-title">{t("rsvpTitle")}</h2>
      {event.rsvp_deadline ? (
        <p className="inv-note">
          {t("rsvpBy")} {formatDeadline(event.rsvp_deadline, lang)}
        </p>
      ) : (
        <div style={{ height: 14 }} />
      )}

      <fieldset className="inv-choices" style={{ border: 0, padding: 0, margin: "0 0 22px" }}>
        <legend className="sr-only">{t("rsvpTitle")}</legend>
        {[
          ["yes", t("yes")],
          ["maybe", t("maybe")],
          ["no", t("no")],
        ].map(([value, label]) => (
          <label key={value} className="inv-choice">
            <input
              type="radio"
              name="attending"
              value={value}
              checked={attending === value}
              onChange={() => {
                setAttending(value);
                setError("");
              }}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      {attending === "yes" ? (
        <>
          <div className="inv-steppers">
            <Stepper label={t("adults")} value={adults} onChange={setAdults} max={cap} />
            <Stepper label={t("children")} value={children} onChange={setChildren} max={cap} />
          </div>

          <div className="inv-field">
            <label className="inv-label" htmlFor="extraNames">
              {t("partyNames")}
              <span className="inv-hint">{t("partyNamesHint")}</span>
            </label>
            <textarea
              id="extraNames"
              className="inv-textarea"
              value={extraNames}
              onChange={(e) => setExtraNames(e.target.value)}
            />
          </div>

          {event.ask_dietary ? (
            <div className="inv-field">
              <label className="inv-label" htmlFor="dietary">
                {t("dietary")}
                <span className="inv-hint">{t("dietaryHint")}</span>
              </label>
              <input
                id="dietary"
                className="inv-input"
                value={dietary}
                onChange={(e) => setDietary(e.target.value)}
              />
            </div>
          ) : null}

          {event.ask_photo ? (
            <div className="inv-field">
              <h3 className="inv-label" style={{ fontSize: 15 }}>
                {t("photoTitle")}
                <span className="inv-hint">{t("photoHint")}</span>
              </h3>

              {preview ? (
                <img src={preview} alt="" className="inv-photo-preview" />
              ) : null}

              <div
                className="inv-photo-drop"
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileRef.current?.click();
                  }
                }}
              >
                {photoState === "working"
                  ? "…"
                  : preview || photoState === "done"
                    ? t("changePhoto")
                    : t("choosePhoto")}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={onPickPhoto}
              />

              {preview ? (
                <>
                  <div className="inv-field" style={{ marginTop: 14, marginBottom: 12 }}>
                    <label className="inv-label" htmlFor="familyName">
                      {t("familyName")}
                      <span className="inv-hint">{t("familyNameHint")}</span>
                    </label>
                    <input
                      id="familyName"
                      className="inv-input"
                      value={familyName}
                      onChange={(e) => setFamilyName(e.target.value)}
                    />
                  </div>
                  <label className="inv-check">
                    <input
                      type="checkbox"
                      checked={photoConsent}
                      onChange={(e) => setPhotoConsent(e.target.checked)}
                    />
                    <span>{t("photoConsent")}</span>
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="inv-field">
        <label className="inv-label" htmlFor="message">
          {t("message")}
        </label>
        <textarea
          id="message"
          className="inv-textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      {error ? <p className="inv-error">{error}</p> : null}

      <button type="submit" className="inv-btn" disabled={saving}>
        {saving ? t("saving") : rsvp ? t("update") : t("submit")}
      </button>
    </form>
  );
}
