import "../globals.css";
import "./invitation.css";

/* Public layout for guest invitations.

   Deliberately outside app/(portal)/ — that group's layout calls
   requireSession() and would bounce every guest to /login.

   That alone is NOT enough: proxy.js (Next 16's renamed middleware) gates the
   whole app, so "/i/" is also listed in its PUBLIC_PREFIXES. Both must stay in
   place — remove either one and every invitation link redirects to /login.

   No sidebar, no tab bar, no service worker, no install prompt: a guest is not
   a portal user and should never see portal chrome. */

export const metadata = {
  title: "You're invited",
  // Invitation links get pasted into WhatsApp and group chats. Indexing them
  // would make a guest list searchable — the token is the only thing keeping
  // an invite private.
  robots: { index: false, follow: false },
};

export default function InviteLayout({ children }) {
  return children;
}
