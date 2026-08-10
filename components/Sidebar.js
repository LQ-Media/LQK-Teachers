"use client";

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
  { href: "/admin", label: "Admin", icon: "settings", roles: ["admin"] },
];

// Reveals its label only when the rail is hovered (group-hover).
function Label({ children, className = "" }) {
  return (
    <span
      className={`w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:w-auto group-hover:opacity-100 ${className}`}
    >
      {children}
    </span>
  );
}

export default function Sidebar({ role, fullName, avatar }) {
  const pathname = usePathname();
  const initial = (fullName || "?").trim().charAt(0).toUpperCase();

  return (
    <aside className="group sticky top-0 z-30 hidden h-screen w-[76px] flex-shrink-0 flex-col gap-1 overflow-hidden border-r border-line bg-paper px-3 py-4 transition-[width] duration-300 ease-out hover:w-[224px] lg:flex">
      {/* Logo */}
      <div className="mb-3 flex items-center gap-2.5 px-1">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control bg-gold-soft">
          <LqkMark className="w-6 h-6" />
        </div>
        <Label>
          <span className="font-heading text-[15px] font-bold text-charcoal">Little Quran Kids</span>
        </Label>
      </div>

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
                <Label>{item.label}</Label>
                <Label className="ml-auto">
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
              className={`flex items-center gap-3 rounded-control px-3 py-2.5 text-[13px] transition-colors ${
                isActive
                  ? "bg-gold-soft font-semibold text-ink"
                  : "text-charcoal hover:bg-paper-deep"
              }`}
            >
              <span className="flex-shrink-0">
                <Icon name={item.icon} size={18} />
              </span>
              <Label>{item.label}</Label>
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
          <Label className="flex-1 text-left font-semibold">{fullName}</Label>
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
            <Label>Log out</Label>
          </button>
        </form>
      </div>
    </aside>
  );
}

