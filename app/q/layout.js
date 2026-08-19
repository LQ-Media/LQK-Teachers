import "../globals.css";

/* Public layout for QR Registration — the door page, a family's pass, the
   booth scanner, the prize counter and the hall leaderboard.

   Deliberately outside app/(portal)/ — that group's layout calls
   requireSession() and would bounce every parent to /login.

   That alone is NOT enough: proxy.js (Next 16's renamed middleware) gates the
   whole app, so "/q/" is also listed in its PUBLIC_PREFIXES. Both must stay in
   place — remove either one and every door scan lands on a login screen, at an
   event, in a queue.

   No sidebar, no tab bar, no install prompt: a parent at the door is not a
   portal user and should never see portal chrome. */

export const metadata = {
  // A pass URL is the family's only credential and the door link gets pasted
  // into group chats. Indexing either would put the whole event's passes one
  // search away.
  robots: { index: false, follow: false },
};

export default function QrLayout({ children }) {
  return children;
}
