"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/* The board is a display, not a page anyone interacts with, so it refreshes
   itself. Fifteen seconds rather than the pass's six: nobody is standing in
   front of it waiting for their own row, and a TV re-rendering every few
   seconds is distracting in the corner of a hall.

   router.refresh() rather than location.reload(): it re-reads the data without
   throwing the page away, so the screen never flashes white in a dark room. */
export default function BoardRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
