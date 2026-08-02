"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfilePhoto, removeProfilePhoto } from "@/lib/actions/profile";
import AvatarCropper from "@/components/AvatarCropper";
import Icon from "@/components/Icon";

// Guard against a browser-hanging decode. The picked file is never uploaded —
// only the 512×512 crop is — so this can afford to be generous.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export default function ProfileForm({ currentSrc, initial }) {
  const router = useRouter();
  const fileRef = useRef(null);
  // The picked File is kept in state (not just read off the input) so "Reposition"
  // can reopen the cropper on the original after a crop has been made.
  const [source, setSource] = useState(null);
  const [cropping, setCropping] = useState(false);
  const [cropped, setCropped] = useState(null); // { blob, url } awaiting Save
  const [error, setError] = useState(null);
  const [pending, start] = useTransition();

  function reset() {
    setSource(null);
    setCropping(false);
    setCropped((c) => {
      if (c?.url) URL.revokeObjectURL(c.url);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function onPick(e) {
    const f = e.target.files?.[0];
    setError(null);
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (f.size > MAX_SOURCE_BYTES) {
      setError("That image is very large — please pick one under 25 MB.");
      return;
    }
    setCropped((c) => {
      if (c?.url) URL.revokeObjectURL(c.url);
      return null;
    });
    setSource(f);
    setCropping(true);
  }

  // The cropper hands back a small JPEG; hold on to it until they press Save.
  function onCropped(blob) {
    setCropped({ blob, url: URL.createObjectURL(blob) });
    setCropping(false);
  }

  function save() {
    if (!cropped) return;
    setError(null);
    start(async () => {
      const data = new FormData();
      // Field name matches what updateProfilePhoto reads; always a JPEG, since
      // that is what the cropper's canvas exports.
      data.set("photo", new File([cropped.blob], "avatar.jpg", { type: "image/jpeg" }));
      const result = await updateProfilePhoto(null, data);
      if (result?.error) {
        setError(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  const shown = cropped?.url || currentSrc;

  return (
    <div className="flex flex-col gap-4 rounded-card border-[0.5px] border-line bg-white p-6">
      <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">Profile photo</div>

      <div className="flex items-center gap-5">
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
            {currentSrc || cropped ? "Choose another" : "Choose image"}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onPick}
            />
          </label>
          <p className="text-[12px] text-charcoal-soft">
            JPEG, PNG, or WebP. Any size or shape — you’ll position it in the circle next.
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || !cropped}
              className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-50"
            >
              {pending ? "Uploading…" : "Save photo"}
            </button>
            {cropped && source && !cropping && (
              <button
                type="button"
                onClick={() => setCropping(true)}
                className="text-[13px] font-semibold text-charcoal-soft hover:text-charcoal"
              >
                Reposition
              </button>
            )}
            {currentSrc && !cropped && (
              <button
                type="button"
                onClick={() =>
                  start(async () => {
                    await removeProfilePhoto();
                    reset();
                    router.refresh();
                  })
                }
                className="text-[13px] font-semibold text-charcoal-soft hover:text-rust"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {cropping && source && (
        <AvatarCropper
          // Remount on a different file so the cropper's zoom/offset reset.
          key={`${source.name}-${source.size}-${source.lastModified}`}
          file={source}
          onConfirm={onCropped}
          onCancel={() => (cropped ? setCropping(false) : reset())}
        />
      )}

      {error && (
        <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>
      )}
    </div>
  );
}
