"use client";

import { useEffect, useState } from "react";

const GREETINGS = [
  "How are you feeling today?",
  "Ready to inspire some young minds?",
  "What would you like to accomplish today?",
  "Let's make it a great learning day!",
  "How can we serve the students today?",
  "What's on your agenda?",
];

export default function HeroClock() {
  const [now, setNow] = useState(null); // client-only, avoids SSR/CSR clock mismatch
  const [gi, setGi] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const clock = setInterval(() => setNow(new Date()), 1000);
    const greet = setInterval(() => setGi((i) => (i + 1) % GREETINGS.length), 5000);
    return () => {
      clearInterval(clock);
      clearInterval(greet);
    };
  }, []);

  const dateStr = now
    ? now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";
  const timeStr = now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "";

  return (
    <>
      <div className="min-h-[22px] text-[16px] font-medium text-gold">{GREETINGS[gi]}</div>
      <div className="text-[13px] text-charcoal-soft">
        {dateStr}
        {timeStr && ` · ${timeStr}`}
      </div>
    </>
  );
}
