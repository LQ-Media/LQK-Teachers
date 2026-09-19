"use client";

import { useRef, useState, useTransition } from "react";
import Icon from "@/components/Icon";
import { shrinkImage } from "@/lib/qr/shrink";
import { generateFamilyPhotoAction, deleteFamilyPhotoAction } from "./actions";

/* The family's pass: proof they're checked in, who is on it, and — if the event
   asks — the family picture.

   The photo flow is deliberately three separate beats: choose, agree, send.
   Bundling the tick-box into the send button is how consent becomes something
   people click past, and this one is about photographs of their children. */

const btn =
  "rounded-pill bg-ink px-6 py-3.5 text-base font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.98] disabled:opacity-50";

export default function Pass({
  token,
  code,
  name,
  eventTitle,
  venue,
  people,
  extraPax,
  photoEnabled,
  photoBlurb,
  consentText,
  photoVersion: initialVersion,
  qr,
}) {
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState(null); // {dataUrl, preview}
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState(null);
  /* The id of the picture currently on file, or null. Doubles as "is there a
     picture" and as the cache-buster in its URL — one piece of state instead
     of a boolean that silently pointed at a stale image. */
  const [photoVersion, setPhotoVersion] = useState(initialVersion);
  // Separate from the above, because "show me the upload control again" must
  // not mean "the picture is gone" — they may change their mind.
  const [retaking, setRetaking] = useState(false);
  const fileRef = useRef(null);

  async function onPick(file) {
    setError(null);
    if (!file) return;
    // Shrunk in the browser first: a photo straight off a phone is 4–8 MB, and
    // it has to fit inside one server-action request alongside nothing else.
    const shrunk = await shrinkImage(file).catch(() => null);
    if (!shrunk) {
      setError("That file couldn’t be read as a photo. Try another one.");
      return;
    }
    setPicked({ dataUrl: shrunk.dataUrl });
  }

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await generateFamilyPhotoAction(token, {
        dataUrl: picked.dataUrl,
        consented,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // The upload is finished with the moment it has been sent — dropping the
      // reference here means the browser isn't holding the original either.
      setPicked(null);
      setConsented(false);
      setPhotoVersion(res.version);
      setRetaking(false);
    });
  }

  const children = people.filter((p) => p.kind === "child");
  const adults = people.filter((p) => p.kind === "adult");

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 py-8">
      <header className="text-center">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">{name}</h1>
        <p className="mt-0.5 text-sm text-charcoal-soft">
          {[eventTitle, venue].filter(Boolean).join(" · ")}
        </p>
      </header>

      <section className="mt-6 rounded-card border border-line bg-white p-6 text-center">
        <p className="inline-flex items-center gap-2 rounded-pill bg-gold-soft px-4 py-1.5 text-sm font-semibold text-ink">
          <Icon name="check" size={15} />
          Checked in
        </p>
        <div className="mx-auto mt-5 w-fit">{qr}</div>
        <p className="mt-3 font-heading text-xl font-semibold tracking-[0.2em] text-ink">{code}</p>
        <p className="mt-1 text-xs text-charcoal-soft">
          Show this if anyone needs to look your family up.
        </p>
      </section>

      <section className="mt-6 rounded-card border border-line bg-white p-5">
        <h2 className="font-heading text-lg font-semibold text-charcoal">
          {people.length + extraPax} {people.length + extraPax === 1 ? "person" : "people"} on this
          pass
        </h2>
        <ul className="mt-3 divide-y divide-line">
          {[...children, ...adults].map((person) => (
            <li key={person.id} className="flex items-center gap-3 py-2.5">
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control ${
                  person.kind === "adult" ? "bg-sage-soft text-sage" : "bg-gold-soft text-ink"
                }`}
              >
                <Icon name={person.kind === "adult" ? "user" : "baby"} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{person.name}</span>
                {person.class_name ? (
                  <span className="block truncate text-xs text-charcoal-soft">{person.class_name}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {extraPax ? (
          <p className="mt-3 text-sm text-charcoal-soft">
            …and {extraPax} more with you.
          </p>
        ) : null}
      </section>

      {photoEnabled ? (
        <section className="mt-6 rounded-card border border-line bg-white p-5">
          <h2 className="font-heading text-lg font-semibold text-charcoal">Your family picture</h2>

          {photoVersion && !retaking ? (
            <>
              <p className="mt-1 text-sm text-charcoal-soft">Here it is — press and hold to save it.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/qr/photo/${token}?v=${photoVersion}`}
                alt={`${name} at ${eventTitle}`}
                className="mt-4 w-full rounded-card border border-line bg-paper"
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={`/api/qr/photo/${token}?v=${photoVersion}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
                >
                  Open full size
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setRetaking(true);
                    setPicked(null);
                    setConsented(false);
                  }}
                  className="rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
                >
                  Try another photo
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await deleteFamilyPhotoAction(token);
                      setPhotoVersion(null);
                      setRetaking(false);
                    })
                  }
                  className="rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-rust transition-transform duration-150 ease-out active:scale-[0.97]"
                >
                  Delete it
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-charcoal-soft">
                {photoBlurb || "Send us a family photo and we’ll turn it into your event picture."}
              </p>

              {photoVersion ? (
                <button
                  type="button"
                  onClick={() => {
                    setRetaking(false);
                    setPicked(null);
                    setConsented(false);
                  }}
                  className="mt-3 text-sm font-semibold text-gold underline"
                >
                  Keep the picture we already have
                </button>
              ) : null}

              <input
                ref={fileRef}
                type="file"
                /* No `capture` attribute, and a broad accept.

                   `capture="environment"` makes iOS and Android open the
                   CAMERA and hide the photo library entirely — so a family
                   who already has the photo they want could not choose it.
                   Without it the OS offers both. `image/*` rather than a
                   list because an iPhone album hands over HEIC, which the
                   browser re-encodes on the way through shrinkImage; naming
                   only JPEG/PNG greys those photos out in the picker. */
                accept="image/*"
                onChange={(e) => onPick(e.target.files?.[0])}
                aria-label="Choose a family photo"
                className="mt-4 w-full text-sm text-charcoal-soft file:mr-3 file:rounded-pill file:border-0 file:bg-paper-deep file:px-5 file:py-3 file:text-sm file:font-semibold file:text-ink"
              />

              {picked ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={picked.dataUrl}
                    alt="The photo you chose"
                    className="mt-4 max-h-64 w-full rounded-card border border-line object-contain"
                  />

                  <label className="mt-4 flex items-start gap-3 rounded-control bg-paper p-3 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={consented}
                      onChange={(e) => setConsented(e.target.checked)}
                      className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[color:var(--color-gold)]"
                    />
                    <span>{consentText}</span>
                  </label>

                  <button
                    type="button"
                    disabled={pending || !consented}
                    onClick={send}
                    className={`${btn} mt-4 w-full`}
                  >
                    {pending ? "Making your picture… this takes a moment" : "Make our picture"}
                  </button>
                </>
              ) : null}
            </>
          )}

          {error ? (
            <p role="alert" className="mt-4 rounded-control bg-rust-soft px-4 py-3 text-sm text-rust">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
