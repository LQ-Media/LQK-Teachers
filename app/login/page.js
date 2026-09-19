import { enabledProviders, providerLabel } from "@/lib/auth/providers";
import LoginPanel from "./LoginPanel";

export const metadata = { title: "Sign in · LQK Teachers Portal" };

/* Anything that went wrong in the OAuth round trip comes back as a short code
   on the URL — app/api/auth/[provider]/callback never puts a provider's own
   error text on screen, since that is attacker-influenced and usually
   incomprehensible anyway. The codes are turned into plain English here. */
function noticeFor(code, provider) {
  const name = provider ? providerLabel(provider) : "that provider";
  switch (code) {
    case "no_account":
      return `No portal account matches that ${name} account. Sign in with your email and password, then connect ${name} from your profile — or ask your admin to add you.`;
    case "cancelled":
      return `${name} sign-in was cancelled.`;
    case "failed":
      return `That ${name} sign-in didn’t complete. Please try again.`;
    case "link_session":
      return "You were signed out before that finished. Sign in again, then connect the account from your profile.";
    case "unavailable":
      return "That sign-in method isn’t available on this server.";
    default:
      return "";
  }
}

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  return (
    <LoginPanel
      providers={enabledProviders()}
      notice={noticeFor(sp?.error || "", sp?.provider || "")}
    />
  );
}
