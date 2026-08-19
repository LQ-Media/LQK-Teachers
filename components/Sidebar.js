"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import Icon from "@/components/Icon";
import LqkMark from "@/components/LqkMark";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "house" },
  { href: "/hafalan", label: "Quran tracker", icon: "clipboard-check" },
  { href: "/reading", label: "My reading", icon: "notebook" },
  { href: "/notebook", label: "Halaqah Notebook", icon: "mic" },
  { href: "/ilmu", label: "Ilmu Bank", icon: "users" },
  { href: "/packs", label: "Lesson Packs", icon: "clipboard-check" },
  { href: "/kalimah", label: "Kalimah", icon: "star" },
  { href: "/dzikir", label: "Wirid & Doa", icon: "moon-star" },
  { href: "/quran", label: "Quran reader", icon: "book-open" },
  { href: "/qibla", label: "Qibla finder", icon: "compass" },
  { href: "/solat", label: "Solat & Azan", icon: "bell" },
  { href: "/achievements", label: "Achievements", icon: "trophy" },
  { href: "/hours", label: "Work hours", icon: "clock" },
  { href: "/events", label: "Events", icon: "calendar", roles: ["admin"] },
  { href: "/qr", label: "QR Registration", icon: "grid", roles: ["admin"] },
  { href: "/admin", label: "Admin", icon: "settings", roles: ["admin"] },
];

const COLLAPSE_KEY = "lqk_sidebar_collapsed";

// The rail is expanded by default, so labels render on the server and stay put.
// Collapsed, the same span animates to zero width rather than unmounting —
// unmounting would make the text pop rather than slide.
function Label({ collapsed, children, className = "" }) {
  return (
    <span
      className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${
        collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
      } ${className}`}
    >
      {children}
    </span>
  );
}

export default function Sidebar({ role, fullName, avatar }) {
  const pathname = usePathname();
  const initial = (fullName || "?").trim().charAt(0).toUpperCase();

  // Expanded is the SSR default; the stored preference is applied after mount
  // so the markup the server sent always matches the first client render.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      // private mode / storage disabled — stay expanded
    }
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <aside
      className={`sticky top-0 z-30 hidden h-screen flex-shrink-0 flex-col gap-1 overflow-hidden border-r border-line bg-paper px-3 py-4 transition-[width] duration-300 ease-out lg:flex ${
        collapsed ? "w-[76px]" : "w-[224px]"
      }`}
    >
      {/* Logo */}
      <div className="mb-1 flex items-center gap-2.5 px-1">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control bg-gold-soft">
          <LqkMark className="w-6 h-6" />
        </div>
        <Label collapsed={collapsed}>
          <span className="font-heading text-[15px] font-bold text-charcoal">Little Quran Kids</span>
        </Label>
      </div>

      {/* Collapse toggle. Its own row rather than sharing the logo's: at 76px
          the mark already fills the rail, leaving nowhere for it to sit. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={`mb-2 flex h-7 items-center rounded-control text-charcoal-soft transition-colors hover:bg-paper-deep hover:text-charcoal ${
          collapsed ? "w-full justify-center" : "ml-auto w-7 justify-center"
        }`}
      >
        <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={16} />
      </button>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          if (item.roles && !item.roles.includes(role)) return null;
          const isActive = pathname === item.href;

          if (item.soon) {
            return (
              <div
                key={item.href}
                className="flex items-center gap-3 rounded-control px-3 py-2.5 text-[13px] text-charcoal-soft/50"
                title={`${item.label} — coming soon`}
              >
                <span className="flex-shrink-0">
                  <Icon name={item.icon} size={18} />
                </span>
                <Label collapsed={collapsed}>{item.label}</Label>
                <Label collapsed={collapsed} className="ml-auto">
                  <span className="rounded-pill bg-paper-deep px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                    Soon
                  </span>
                </Label>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 rounded-control px-3 py-2.5 text-[13px] transition-colors ${
                isActive
                  ? "bg-gold-soft font-semibold text-ink"
                  : "text-charcoal hover:bg-paper-deep"
              }`}
            >
              <span className="flex-shrink-0">
                <Icon name={item.icon} size={18} />
              </span>
              <Label collapsed={collapsed}>{item.label}</Label>
            </Link>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="mt-2 border-t border-line pt-3">
        <Link
          href="/profile"
          title={`${fullName} — profile`}
          className={`flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-[13px] transition-colors ${
            pathname === "/profile"
              ? "bg-gold-soft font-semibold text-ink"
              : "text-charcoal hover:bg-paper-deep"
          }`}
        >
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-sand text-[11px] font-bold text-ink">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </span>
          <Label collapsed={collapsed} className="flex-1 text-left font-semibold">
            {fullName}
          </Label>
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-[13px] text-charcoal-soft transition-colors hover:bg-paper-deep hover:text-charcoal"
            title="Log out"
          >
            <span className="flex-shrink-0">
              <Icon name="log-out" size={18} />
            </span>
            <Label collapsed={collapsed}>Log out</Label>
          </button>
        </form>
      </div>
    </aside>
  );
}

