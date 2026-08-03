"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import Icon from "@/components/Icon";

// The four destinations that earn a permanent slot; everything else lives in
// the "More" sheet. Mirrors the desktop sidebar's icons exactly.
const TABS = [
  { href: "/dashboard", label: "Home", icon: "house" },
  { href: "/hafalan", label: "Tracker", icon: "clipboard-check" },
  { href: "/dzikir", label: "Wirid & Doa", icon: "moon-star" },
  { href: "/quran", label: "Quran", icon: "book-open" },
];

const MORE_ITEMS = [
  { href: "/reading", label: "My reading", icon: "notebook" },
  { href: "/notebook", label: "Notebook", icon: "mic" },
  { href: "/ilmu", label: "Ilmu Bank", icon: "users" },
  { href: "/packs", label: "Lesson Packs", icon: "clipboard-check" },
  { href: "/kalimah", label: "Kalimah", icon: "star" },
  { href: "/qibla", label: "Qibla", icon: "compass" },
  { href: "/achievements", label: "Awards", icon: "trophy" },
  { href: "/hours", label: "Work hours", icon: "clock" },
  { href: "/admin", label: "Admin", icon: "settings", roles: ["admin"] },
  { href: "/profile", label: "Profile", icon: "user" },
];

function isUnder(pathname, href) {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * App-style bottom navigation, phones/tablets only (the sidebar takes over at
 * lg). Four fixed tabs + a "More" bottom sheet holding the rest of the nav.
 */
export default function MobileTabBar({ role }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const moreItems = MORE_ITEMS.filter((i) => !i.roles || i.roles.includes(role));
  const moreActive = moreItems.some((i) => isUnder(pathname, i.href));

  // Close the sheet whenever navigation happens, and on Escape.
  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t-[0.5px] border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5">
          {TABS.map((tab) => {
            const active = isUnder(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="flex flex-col items-center justify-center gap-0.5 transition-transform duration-150 ease-out active:scale-95"
              >
                <span
                  className={`flex h-8 w-14 items-center justify-center rounded-pill transition-colors duration-150 ${
                    active ? "bg-gold text-ink" : "text-charcoal-soft"
                  }`}
                >
                  <Icon name={tab.icon} size={20} />
                </span>
                <span
                  className={`text-[10px] leading-none ${
                    active ? "font-bold text-charcoal" : "font-semibold text-charcoal-soft"
                  }`}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className="flex flex-col items-center justify-center gap-0.5 transition-transform duration-150 ease-out active:scale-95"
          >
            <span
              className={`flex h-8 w-14 items-center justify-center rounded-pill transition-colors duration-150 ${
                moreActive ? "bg-gold text-ink" : "text-charcoal-soft"
              }`}
            >
              <Icon name="grid" size={20} />
            </span>
            <span
              className={`text-[10px] leading-none ${
                moreActive ? "font-bold text-charcoal" : "font-semibold text-charcoal-soft"
              }`}
            >
              More
            </span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-ink/30 opacity-100 transition-opacity duration-200 starting:opacity-0"
          />
          <div className="absolute inset-x-0 bottom-0 translate-y-0 rounded-t-3xl border-t-[0.5px] border-line bg-paper px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] starting:translate-y-full">
            <div className="mx-auto mb-3 h-1 w-9 rounded-pill bg-line" />
            <div className="grid grid-cols-4 gap-1.5">
              {moreItems.map((item) => {
                const active = isUnder(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex flex-col items-center gap-1.5 rounded-card p-2.5 transition-transform duration-150 ease-out active:scale-95"
                  >
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-control ${
                        active ? "bg-gold text-ink" : "bg-sand/50 text-ink"
                      }`}
                    >
                      <Icon name={item.icon} size={20} />
                    </span>
                    <span className="text-center text-[11px] font-semibold leading-tight text-charcoal">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
            <form action={logout} className="mt-3 border-t-[0.5px] border-line pt-3">
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-control py-2.5 text-[13px] font-semibold text-charcoal-soft transition-colors active:bg-paper-deep"
              >
                <Icon name="log-out" size={16} />
                Log out
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
