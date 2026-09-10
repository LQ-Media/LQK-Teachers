"use client";

import { useActionState, useState } from "react";
import { login, register } from "@/lib/actions/auth";
import { LOCATIONS } from "@/lib/locations";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import LqkMark from "@/components/LqkMark";

const fieldClass =
  "bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

const PROVIDER_ERRORS = {
  provider: "That sign-in method isn't available here.",
  denied: "You cancelled the sign-in at the provider.",
  state: "That sign-in link had expired. Please try again.",
  failed: "The provider didn't confirm who you are. Try again, or sign in with your password.",
  noemail: "The provider didn't share an email address, so the account can't be matched. Use Google, Microsoft, or your password.",
};

/**
 * Sign in / Register. `providers` are the social sign-ins the server has
 * credentials for; `prefill` arrives from /api/auth/<provider>/callback when
 * a first-time social user has no account yet, and opens the Register tab
 * with their name and email filled in.
 */
export default function LoginClient({ providers = [], prefill = null, error = "" }) {
  const [mode, setMode] = useState(prefill ? "register" : "signin");

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-card bg-paper-deep border-[0.5px] border-line flex items-center justify-center mb-4">
            <LqkMark className="w-8 h-8" />
          </div>
          <h1 className="font-heading text-xl font-semibold text-charcoal">Little Quran Kids</h1>
          <p className="text-[11px] uppercase tracking-wider text-charcoal-soft font-semibold mt-1">
            Teachers Portal
          </p>
        </div>

        <div className="mb-4 flex gap-1 rounded-control bg-paper-deep p-1">
          <ModeTab active={mode === "signin"} onClick={() => setMode("signin")}>
            Sign in
          </ModeTab>
          <ModeTab active={mode === "register"} onClick={() => setMode("register")}>
            Register
          </ModeTab>
        </div>

        {error && PROVIDER_ERRORS[error] && (
          <p className="mb-4 rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{PROVIDER_ERRORS[error]}</p>
        )}
        {prefill && mode === "register" && (
          <p className="mb-4 rounded-control bg-gold-soft/50 px-3 py-2 text-[12px] text-charcoal">
            No portal account uses <span className="font-semibold">{prefill.email}</span> yet. Create one below and your{" "}
            {prefill.providerLabel} sign-in will be attached to it.
          </p>
        )}

        {mode === "register" ? <RegisterForm prefill={prefill} /> : <SignInForm />}

        {providers.length > 0 && (
          <div className="mt-4">
            <div className="mb-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-charcoal-soft">
              <span className="h-px flex-1 bg-line" />
              or continue with
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="flex flex-col gap-2">
              {providers.map((p) => (
                <a
                  key={p.key}
                  href={`/api/auth/${p.key}/start`}
                  className="flex items-center justify-center gap-2 rounded-control border-[0.5px] border-line bg-white px-4 py-[10px] text-[13px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
                >
                  <ProviderMark provider={p.key} />
                  Continue with {p.label}
                </a>
              ))}
            </div>
            <p className="mt-2 text-center text-[11px] text-charcoal-soft">
              Uses the email on your account. Your password still works.
            </p>
          </div>
        )}

        <InstallPrompt />
      </div>
    </div>
  );
}

function ModeTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-control px-3 py-2 text-[13px] font-semibold transition-colors ${
        active ? "bg-white text-ink shadow-sm" : "text-charcoal-soft hover:text-charcoal"
      }`}
    >
      {children}
    </button>
  );
}

function SignInForm() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <>

        <form action={formAction} className="bg-white border-[0.5px] border-line rounded-card p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-[11px] font-semibold text-charcoal-soft">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-[11px] font-semibold text-charcoal-soft">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
            />
          </div>

          {state?.error && (
            <p className="text-[12px] font-medium text-rust bg-rust-soft rounded-control px-3 py-2">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="bg-ink text-paper rounded-control px-[18px] py-[10px] text-[13px] font-semibold hover:bg-ink-deep disabled:opacity-60 transition-colors mt-1"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Demo accounts are only seeded outside production (see seedIfEmpty in
            lib/db.js), so only advertise them there — a production deploy has no
            such accounts and must not imply it does. */}
        {process.env.NODE_ENV !== "production" && (
          <div className="mt-5 text-[11px] text-charcoal-soft text-center leading-relaxed">
            Demo accounts (password: <span className="font-semibold">password123</span>)
            <br />
            teacher@lqk.test · reviewer@lqk.test · admin@lqk.test
          </div>
        )}
    </>
  );
}

function RegisterForm({ prefill }) {
  const [state, formAction, pending] = useActionState(register, undefined);
  // HQ is the branch that grants admin, so it asks for the shared code. The
  // server enforces this regardless of what the form shows.
  const [branch, setBranch] = useState("");

  return (
    <>
      <form action={formAction} className="bg-white border-[0.5px] border-line rounded-card p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg_name" className="text-[11px] font-semibold text-charcoal-soft">
            Full name
          </label>
          <input id="reg_name" name="full_name" type="text" required autoComplete="name" className={fieldClass} defaultValue={prefill?.name || ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg_email" className="text-[11px] font-semibold text-charcoal-soft">
            Email
          </label>
          <input id="reg_email" name="email" type="email" required autoComplete="email" className={fieldClass} defaultValue={prefill?.email || ""} />
        </div>
        {/* An admin can still pre-assign a branch with an invite; this is what
            everyone else gets asked, so no account starts branchless. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg_branch" className="text-[11px] font-semibold text-charcoal-soft">
            Branch
          </label>
          <select
            id="reg_branch"
            name="primary_location"
            required
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className={fieldClass}
          >
            <option value="" disabled>
              Select your branch…
            </option>
            {LOCATIONS.map((location) => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-charcoal-soft">
            Your admin can change this later.
          </span>
        </div>

        {branch === "HQ" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg_hq_code" className="text-[11px] font-semibold text-charcoal-soft">
              HQ access code
            </label>
            <input
              id="reg_hq_code"
              name="hq_code"
              type="password"
              required
              autoComplete="off"
              className={fieldClass}
            />
            <span className="text-[11px] text-charcoal-soft">
              An HQ account has admin access. Ask an admin for the code.
            </span>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg_password" className="text-[11px] font-semibold text-charcoal-soft">
            Password
          </label>
          <input
            id="reg_password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={fieldClass}
          />
          <span className="text-[11px] text-charcoal-soft">At least 8 characters.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg_confirm" className="text-[11px] font-semibold text-charcoal-soft">
            Confirm password
          </label>
          <input
            id="reg_confirm"
            name="confirm_password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={fieldClass}
          />
        </div>

        {state?.error && (
          <p className="text-[12px] font-medium text-rust bg-rust-soft rounded-control px-3 py-2">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="bg-ink text-paper rounded-control px-[18px] py-[10px] text-[13px] font-semibold hover:bg-ink-deep disabled:opacity-60 transition-colors mt-1"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-charcoal-soft">
        Use your work email. Your admin can adjust your branch and role after you sign up.
      </p>
    </>
  );
}


/* Small monochrome marks so the buttons read at a glance without shipping
   the providers' brand assets. */
function ProviderMark({ provider }) {
  if (provider === "google") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.68-.06-1.36-.19-2.02H12v3.83h5.4a4.62 4.62 0 0 1-2 3.03v2.5h3.23c1.9-1.75 2.97-4.32 2.97-7.34z" />
        <path fill="#34A853" d="M12 21.6c2.7 0 4.97-.9 6.63-2.43l-3.23-2.5c-.9.6-2.05.95-3.4.95-2.6 0-4.8-1.76-5.6-4.12H3.07v2.58A9.99 9.99 0 0 0 12 21.6z" />
        <path fill="#FBBC05" d="M6.4 13.5a6 6 0 0 1 0-3.84V7.08H3.07a10 10 0 0 0 0 8.98L6.4 13.5z" />
        <path fill="#EA4335" d="M12 6.38c1.47 0 2.78.5 3.82 1.5l2.86-2.86A9.96 9.96 0 0 0 12 2.4a9.99 9.99 0 0 0-8.93 5.5L6.4 10.5c.8-2.36 3-4.12 5.6-4.12z" />
      </svg>
    );
  }
  if (provider === "microsoft") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
        <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
        <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
        <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.93-1.95 1.87V12h3.32l-.53 3.47h-2.8v8.38A12 12 0 0 0 24 12z" />
    </svg>
  );
}
