import { cookies } from "next/headers";
import { decrypt } from "@/lib/session";
import { configuredProviders, PROVIDERS, isProvider } from "@/lib/auth/oauth";
import LoginClient from "@/components/LoginClient";

export const metadata = { title: "Sign in · LQK Teachers Portal" };

/**
 * Server half of the login page: which social sign-ins exist here, and
 * whether the person just arrived from one with no account yet (in which
 * case the callback left their name and email in a signed cookie).
 */
export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const providers = configuredProviders();
  const error = typeof sp?.error === "string" ? sp.error : "";

  let prefill = null;
  if (sp?.register === "1") {
    const pending = await decrypt((await cookies()).get("lqk_oauth_pending")?.value);
    if (pending && isProvider(pending.p) && pending.e) {
      prefill = { name: pending.n || "", email: pending.e, providerLabel: PROVIDERS[pending.p].label };
    }
  }

  return <LoginClient providers={providers} prefill={prefill} error={error} />;
}
