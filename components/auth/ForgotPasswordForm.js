"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/lib/actions/auth";

const fieldClass =
  "bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, undefined);

  // Once the notice is showing, the form is replaced rather than left in place.
  // Leaving it there invites a second and third tap, all three emails land, and
  // the teacher then opens the oldest link — which by then has been burnt by the
  // newest one (see createResetToken).
  if (state?.sent) {
    return (
      <div className="rounded-card border-[0.5px] border-line bg-white p-6 text-center">
        <p className="text-[13px] leading-relaxed text-charcoal">{state.sent}</p>
        <Link
          href="/login"
          className="mt-5 inline-block rounded-control bg-ink px-[18px] py-[10px] text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-card border-[0.5px] border-line bg-white p-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="forgot_email" className="text-[11px] font-semibold text-charcoal-soft">
          Email
        </label>
        <input
          id="forgot_email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          className={fieldClass}
        />
        <span className="text-[11px] text-charcoal-soft">The work email you sign in with.</span>
      </div>

      {state?.error && (
        <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-control bg-ink px-[18px] py-[10px] text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a reset link"}
      </button>

      <Link href="/login" className="text-center text-[12px] font-semibold text-charcoal-soft hover:text-charcoal">
        Back to sign in
      </Link>
    </form>
  );
}
