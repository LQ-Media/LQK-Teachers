"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProfilePhoto, removeProfilePhoto } from "@/lib/actions/profile";
import Icon from "@/components/Icon";

export default function ProfileForm({ currentSrc, initial }) {
  const router = useRouter();
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null); // object URL for the picked file
  const [state, formAction, pending] = useActionState(async (prev, formData) => {
    const result = await updateProfilePhoto(prev, formData);
    if (result?.ok) {
      // Clear the picked-file preview and refresh the route tree (incl. the
      // sidebar avatar). Done here — not in an effect — so it runs once per submit.
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    }
    return result;
  }, undefined);

  const shown = preview || currentSrc;

  return (
    <div className="flex flex-col gap-4 rounded-card border-[0.5px] border-line bg-white p-6">
      <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">Profile photo</div>

      <form action={formAction} className="flex items-center gap-5">
        <div className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-full bg-sand text-[26px] font-bold text-ink">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-control border-[0.5px] border-line bg-paper px-3.5 py-2 text-[13px] font-semibold text-charcoal transition-colors hover:bg-paper-deep">
            <Icon name="camera" size={15} />
            Choose image
            <input
              ref={fileRef}
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
          <p className="text-[12px] text-charcoal-soft">JPEG, PNG, or WebP · up to 3 MB.</p>

          <div className="mt-1 flex items-center gap-2">
            <button
              type="submit"
              disabled={pending || !preview}
              className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-50"
            >
              {pending ? "Uploading…" : "Save photo"}
            </button>
            {currentSrc && (
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  removeProfilePhoto().then(() => router.refresh());
                }}
                className="text-[13px] font-semibold text-charcoal-soft hover:text-rust"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </form>

      {state?.error && (
        <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{state.error}</p>
      )}
    </div>
  );
}
