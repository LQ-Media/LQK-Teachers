"use client";

import { useActionState } from "react";
import { resetPassword } from "@/lib/actions/auth";

const fieldClass =
  "bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[14px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

export default function ResetPasswordForm({ token }) {
  const [state, formAction, pending] = useActionState(resetPassword, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-card border-[0.5px] border-line bg-white p-6">
      {/* The token stays in a hidden field rather than being re-read from the
          URL server-side, so the action is self-contained and the link can be
          redeemed on a page the user has had open for a while. */}
      <input type="hidden" name="token" value={token} />

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-charcoal-soft">New password</span>
        <input
          type="password"
          name="new_password"
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
          className={fieldClass}
        />
        <span className="text-[11px] text-charcoal-soft">At least 8 characters.</span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-charcoal-soft">Confirm new password</span>
        <input
          type="password"
          name="confirm_password"
          autoComplete="new-password"
          minLength={8}
          required
          className={fieldClass}
        />
      </label>

      {state?.error && (
        <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-control bg-ink px-[18px] py-[11px] text-[14px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
      >
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
