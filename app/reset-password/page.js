import Link from "next/link";
import { getDb } from "@/lib/db";
import { findResetByToken, isResetUsable } from "@/lib/auth/reset";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import LqkMark from "@/components/LqkMark";

export const metadata = { title: "Choose a new password · LQK Teachers Portal" };

/* The token is checked HERE as well as in the action, so a dead link says so
   immediately instead of after someone has typed a password twice. The check
   that actually matters is still the one in resetPassword — this page is a
   courtesy, and a page render is not a security boundary. */
export default async function ResetPasswordPage({ searchParams }) {
  const { token = "" } = await searchParams;
  const valid = token ? isResetUsable(findResetByToken(getDb(), token)) : false;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-card border-[0.5px] border-line bg-paper-deep">
            <LqkMark className="h-8 w-8" />
          </div>
          <h1 className="font-heading text-xl font-semibold text-charcoal">
            {valid ? "Choose a new password" : "This link has expired"}
          </h1>
          <p className="mt-1 text-center text-[13px] leading-relaxed text-charcoal-soft">
            {valid
              ? "Pick something you haven’t used elsewhere. You’ll be signed in straight after."
              : "Reset links work once and last an hour. Ask for a fresh one and it’ll be in your inbox in a moment."}
          </p>
        </div>

        {valid ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="rounded-card border-[0.5px] border-line bg-white p-6 text-center">
            <Link
              href="/forgot-password"
              className="inline-block rounded-control bg-ink px-[18px] py-[10px] text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep"
            >
              Send a new link
            </Link>
            <p className="mt-4">
              <Link href="/login" className="text-[12px] font-semibold text-charcoal-soft hover:text-charcoal">
                Back to sign in
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
