// Client-safe display helpers for the Quran tracker (no server imports).

export function titleCase(name) {
  if (!name || name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
  const t = name.toLowerCase().replace(/(^|\s)([a-z])/g, (_, sp, ch) => sp + ch.toUpperCase());
  return t.replace(/\bD\/o\b/gi, "D/O").replace(/\bS\/o\b/gi, "S/O");
}

export function initials(name) {
  return (name || "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(d) {
  const p = String(d || "").slice(0, 10).split("-");
  return p.length < 3 ? d : `${p[2]} ${MONTHS[Number(p[1]) - 1]} ${p[0]}`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function sgTodayLabel() {
  const n = new Date();
  const sg = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  const m = sg.getMonth() + 1;
  const d = sg.getDate();
  const iso = `${sg.getFullYear()}-${m < 10 ? "0" : ""}${m}-${d < 10 ? "0" : ""}${d}`;
  return `${DAY_NAMES[sg.getDay()]}, ${fmtDate(iso)}`;
}

/** Tailwind classes for a grade pill. */
export function gradePillClass(grade) {
  const g = (grade || "").toLowerCase();
  if (g === "excellent") return "bg-sage-soft text-sage";
  if (g === "repeat") return "bg-rust-soft text-rust";
  if (g === "pass") return "bg-gold-soft/50 text-[#8A6D1F]";
  return "bg-paper-deep text-charcoal-soft";
}
