"use client";
/* TEMPORARY dev-only harness — deleted after verification. */
import { useState } from "react";
import Combobox from "@/components/events/Combobox";
import { DRESS_CODE_GROUPS } from "@/lib/events/presets";

export default function DressCheck() {
  const [v, setV] = useState("");
  return (
    <div style={{ padding: 24, maxWidth: 420, background: "#fff", minHeight: "100vh" }}>
      <label htmlFor="f-dress">Dress code</label>
      <Combobox id="f-dress" value={v} onChange={setV} groups={DRESS_CODE_GROUPS} placeholder="Pick one, or type your own" ariaLabel="Dress code" />
      <p data-testid="chosen">chosen: {v || "(empty)"}</p>
    </div>
  );
}
