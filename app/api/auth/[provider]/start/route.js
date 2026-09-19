import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/mail";
import { getSession } from "@/lib/session";
import { PROVIDERS, providerConfigured } from "@/lib/auth/providers";
import { startAuth } from "@/lib/auth/oauth";

/* Step 1 of social sign-in: send the browser to the provider.
   The matching callback is ../callback/route.js. */

export const dynamic = "force-dynamic";

export async function GET(request, ctx) {
  const { provider } = await ctx.params;
  const home = baseUrl();

  if (!PROVIDERS[provider] || !providerConfigured(provider)) {
    return NextResponse.redirect(`${home}/login?error=unavailable`);
  }

  // "link" attaches the provider account to the profile that is ALREADY signed
  // in — how a teacher connects a personal Gmail, or an Apple ID hidden behind
  // a relay address, that could never be matched to their work email on its own.
  const wantsLink = new URL(request.url).searchParams.get("link") === "1";
  let profileId = null;
  if (wantsLink) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.redirect(`${home}/login`);
    profileId = session.userId;
  }

  try {
    const url = await startAuth(provider, { mode: wantsLink ? "link" : "signin", profileId });
    return NextResponse.redirect(url);
  } catch {
    // startAuth only throws on missing configuration or a missing SESSION_SECRET
    // — nothing here is worth leaking to the browser.
    return NextResponse.redirect(`${home}/login?error=unavailable`);
  }
}
