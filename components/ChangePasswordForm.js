"use client";

import { useActionState } from "react";
import { changePassword } from "@/lib/actions/auth";

export default function ChangePasswordForm({ mustChange }) {
  const [state, formAction, pending] = useActionState(changePassword, undefined);

  const field =
    "bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[14px] text-charcoal outline-none focus:border-gold focus:ring-[1.5px] focus:ring-gold";

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-card border-[0.5px] border-line bg-white p-6">
      {!mustChange && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-charcoal-soft">Current password</span>
          <input type="password" name="current_password" autoComplete="current-password" className={field} required />
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-charcoal-soft">New password</span>
        <input type="password" name="new_password" autoComplete="new-password" minLength={8} className={field} required />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-charcoal-soft">Confirm new password</span>
        <input type="password" name="confirm_password" autoComplete="new-password" minLength={8} className={field} required />
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
