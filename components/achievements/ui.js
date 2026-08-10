"use client";

import { initials } from "@/components/tracker/util";
import Icon from "@/components/Icon";
import { MAX_LEVEL, formatPoints } from "@/lib/achievements/points";

export const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

export function Card({ children, className = "" }) {
  return (
    <div className={`rounded-card border-[0.5px] border-line bg-white p-5 ${className}`}>{children}</div>
  );
}

export function SectionTitle({ children, note }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-heading text-[15px] font-bold text-charcoal">{children}</h2>
      {note && <span className="text-[11px] text-charcoal-soft">{note}</span>}
    </div>
  );
}

export function Avatar({ src, name, size = 36 }) {
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-sand text-[11px] font-bold text-ink"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** Ten stars, filled up to `level`. */
export function StarRow({ level, size = 14 }) {
  return (
    <span className="flex items-center gap-[3px]" title={`Level ${level} of ${MAX_LEVEL}`}>
      {Array.from({ length: MAX_LEVEL }, (_, i) => (
        <span key={i} className={i < level ? "text-gold" : "text-line"}>
          <Icon name="star" size={size} filled={i < level} strokeWidth={1.25} />
        </span>
      ))}
    </span>
  );
}

export function ProgressBar({ value, className = "" }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-pill bg-paper-deep ${className}`}>
      <div
        className="h-full rounded-pill bg-gradient-to-r from-gold to-[#D9A648] transition-[width] duration-500"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  );
}

export function Pill({ children, tone = "default" }) {
  const tones = {
    default: "bg-paper-deep text-charcoal-soft",
    gold: "bg-gold-soft text-[#3E5438]",
    good: "bg-sage-soft text-sage",
    bad: "bg-rust-soft text-rust",
  };
  return (
    <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function StatTile({ icon, label, value, note }) {
  return (
    <div className="rounded-card border-[0.5px] border-line bg-white p-4">
      <div className="mb-2 flex items-center gap-2 text-charcoal-soft">
        <Icon name={icon} size={16} />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="font-heading text-[20px] font-bold text-charcoal">{value}</div>
      {note && <div className="text-[12px] text-charcoal-soft">{note}</div>}
    </div>
  );
}

export function Empty({ children }) {
  return (
    <p className="rounded-card border border-dashed border-line bg-white/60 px-5 py-8 text-center text-[13px] text-charcoal-soft">
      {children}
    </p>
  );
}

export function Points({ n, className = "" }) {
  return (
    <span className={className}>
      <span className="font-heading font-bold">{formatPoints(n)}</span>
      <span className="text-[11px] text-charcoal-soft"> pts</span>
    </span>
  );
}
