import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import LqkMark from "@/components/LqkMark";

export const metadata = { title: "Reset your password · LQK Teachers Portal" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-card border-[0.5px] border-line bg-paper-deep">
            <LqkMark className="h-8 w-8" />
          </div>
          <h1 className="font-heading text-xl font-semibold text-charcoal">Forgot your password?</h1>
          <p className="mt-1 text-center text-[13px] leading-relaxed text-charcoal-soft">
            Enter your email and we’ll send you a link to choose a new one.
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
