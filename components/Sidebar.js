"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import Icon from "@/components/Icon";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "house" },
  { href: "/hafalan", label: "Quran tracker", icon: "clipboard-check" },
  { href: "/reading", label: "My reading", icon: "notebook" },
  { href: "/quran", label: "Quran reader", icon: "book-open" },
  { href: "/achievements", label: "Achievements", icon: "trophy", soon: true },
  { href: "/hours", label: "Work hours", icon: "clock", soon: true },
  { href: "/admin", label: "Admin", icon: "settings", roles: ["admin"], soon: true },
];

export default function Sidebar({ role, fullName, pendingReviewCount }) {
  const pathname = usePathname();

  return (
    <aside className="w-60 flex-shrink-0 bg-ink min-h-screen flex flex-col py-6 px-4">
      <div className="flex items-center gap-2.5 px-2 mb-8">
        <div className="w-9 h-9 rounded-control bg-paper flex items-center justify-center flex-shrink-0">
          <LqkMark className="w-5 h-5" />
        </div>
        <div className="leading-tight">
          <div className="font-heading text-[15px] font-bold text-paper">Little Quran Kids</div>
          <div className="text-[10px] uppercase tracking-wider text-paper/70">Teachers Portal</div>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          if (item.roles && !item.roles.includes(role)) return null;
          const isActive = pathname === item.href;

          if (item.soon) {
            return (
              <div
                key={item.href}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-control text-[13px] text-paper/40 cursor-default"
              >
                <span className="flex items-center gap-2.5">
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wide bg-white/10 rounded-pill px-1.5 py-0.5">
                  Soon
                </span>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-control text-[13px] transition-colors ${
                isActive
                  ? "bg-white/20 text-paper font-semibold"
                  : "text-paper/80 hover:bg-white/10 hover:text-paper"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon name={item.icon} size={18} />
                {item.label}
              </span>
              {item.href === "/review" && pendingReviewCount > 0 && (
                <span className="bg-rust text-white text-[10px] font-bold rounded-pill px-1.5 py-0.5 min-w-[18px] text-center">
                  {pendingReviewCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/20 pt-4 mt-4 px-2">
        <div className="text-[13px] font-semibold text-paper mb-2">{fullName}</div>
        <form action={logout}>
          <button
            type="submit"
            className="text-[12px] font-semibold text-paper/70 hover:text-paper transition-colors"
          >
            Log out
          </button>
        </form>
      </div>
    </aside>
  );
}

function LqkMark({ className }) {
  return (
    <svg className={className} viewBox="0 0 850.39 850.39" xmlns="http://www.w3.org/2000/svg">
      <path fill="#f0a41f" d="M251.81,540.08c-2.58.14-5.17.58-7.69,1.29-14.7,4.19-29.37,8.79-43.6,13.68-1.61.55-3.26.88-4.91.97-4.93.27-9.83-1.59-13.44-5.1-3.61-3.5-5.53-8.21-5.41-13.13v-.4c2.67-58.14,13.53-206.63,22.56-265.12,1.6-10.38-1.51-20.79-8.53-28.55-7.09-7.83-17.13-11.99-27.55-11.43-2.76.15-5.52.64-8.21,1.45l-35.25,10.59c-12.63,3.8-22.16,14.65-24.27,27.64-10.97,67.48-17.57,198.86-21.94,285.8l-1.2,23.83c-1.39,35.06-1.78,63.42-1.24,89.24.2,9.5,4.13,18.28,11.05,24.7,6.91,6.41,16.21,9.79,25.51,9.29,4.8-.26,9.45-1.52,13.82-3.74,48.61-24.71,100.97-46.17,140.07-57.41,14.21-4.09,24.24-16.8,24.97-31.63l1.74-35.58c.48-9.81-3.23-19.4-10.18-26.31-6.98-6.94-16.56-10.62-26.28-10.09Z"/>
      <path fill="#f0a41f" d="M686.24,387.75c-20.57-20.57-20.57-53.91,0-74.47l77.86-77.86c20.57-20.57,20.57-53.91,0-74.47-20.57-20.57-53.91-20.57-74.47,0l-122.85,122.85c-32.05-55.78-92.18-93.38-161.13-93.38-105.5,0-190.46,87.95-185.55,194.53,4.38,95.16,81.62,172.4,176.78,176.78,39.66,1.82,76.73-8.8,107.66-28.29l28.49,28.49c16.12,16.12,42.26,16.12,58.38,0h0c16.12-16.12,16.12-42.26,0-58.38l-28.49-28.49c8.2-13.02,14.84-27.12,19.63-42.06l107.09,107.09c20.57,20.57,53.91,20.57,74.47,0,20.57-20.57,20.57-53.91,0-74.47l-77.86-77.86ZM501.17,413.31c-16.12-16.12-42.26-16.12-58.38,0h0c-16.12,16.12-16.12,42.26,0,58.38l.51.51c-9.51,3.76-19.68,6.16-30.29,6.9-60.22,4.21-110.57-43.6-110.57-102.94s46.29-103.2,103.2-103.2,107.15,50.35,102.94,110.57c-.74,10.6-3.14,20.78-6.9,30.29l-.51-.51Z"/>
      <path fill="#f0a41f" d="M412.21,410.69c-1.6.54-3.24,1-4.93,1.38-23.37,5.18-47.85-8.94-56.79-32.77-10.59-28.2,3.48-58.66,30.12-66.83.42-.13.84-.25,1.27-.37,5.04-1.39,9.04,4.71,6.06,9.15-8.35,12.42-11.15,28.84-6.23,44.85,4.92,16.01,16.45,28.05,30.34,33.65,4.93,1.99,5.1,9.27.18,10.95Z"/>
      <path fill="#f0a41f" d="M425.72,330.39l3.85,7.81c.66,1.33,1.92,2.25,3.39,2.46l8.62,1.25c3.69.54,5.16,5.07,2.49,7.68l-6.24,6.08c-1.06,1.03-1.54,2.52-1.29,3.98l1.47,8.58c.63,3.68-3.23,6.48-6.53,4.74l-7.71-4.05c-1.31-.69-2.88-.69-4.19,0l-7.71,4.05c-3.3,1.74-7.16-1.07-6.53-4.74l1.47-8.58c.25-1.46-.23-2.95-1.29-3.98l-6.24-6.08c-2.67-2.6-1.2-7.14,2.49-7.68l8.62-1.25c1.47-.21,2.73-1.13,3.39-2.46l3.85-7.81c1.65-3.34,6.42-3.34,8.07,0Z"/>
    </svg>
  );
}
