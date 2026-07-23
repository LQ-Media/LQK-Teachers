import { requireSession } from "@/lib/dal";
import ChangePasswordForm from "@/components/ChangePasswordForm";

export const metadata = { title: "Set your password · LQK Teachers Portal" };

export default async function ChangePasswordPage() {
  const session = await requireSession();
  const mustChange = !!session.mustChange;

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="font-heading text-xl font-semibold text-charcoal">
            {mustChange ? "Welcome — set your password" : "Change password"}
          </h1>
          <p className="mt-1 text-[13px] text-charcoal-soft">
            {mustChange
              ? "For your security, please choose your own password before continuing."
              : "Choose a new password for your account."}
          </p>
        </div>
        <ChangePasswordForm mustChange={mustChange} />
      </div>
    </div>
  );
}
