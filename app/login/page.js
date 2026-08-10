"use client";

import { useActionState, useState } from "react";
import { login, register } from "@/lib/actions/auth";
import { LOCATIONS } from "@/lib/locations";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import LqkMark from "@/components/LqkMark";

const fieldClass =
  "bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

export default function LoginPage() {
  const [mode, setMode] = useState("signin");

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

        {mode === "register" ? <RegisterForm /> : <SignInForm />}

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

function RegisterForm() {
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
          <input id="reg_name" name="full_name" type="text" required autoComplete="name" className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg_email" className="text-[11px] font-semibold text-charcoal-soft">
            Email
          </label>
          <input id="reg_email" name="email" type="email" required autoComplete="email" className={fieldClass} />
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

