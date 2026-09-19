"use client";

import { useActionState } from "react";
import { disconnectProvider } from "@/lib/actions/auth";
import ProviderMark from "./ProviderMark";

/* Profile → Connected accounts.

   Two jobs. The obvious one is convenience: tap Google next time instead of
   typing a password. The one that actually matters is that this is the ONLY way
   in for an account whose provider email can't be matched automatically — a
   personal Gmail that isn't the work address, an Apple ID hidden behind a
   private relay, or a Microsoft account from outside a pinned tenant. Signing in
   first and linking here proves the two accounts belong to the same person,
   which an email claim on its own never does.

   Connecting is a redirect, so it's a link. Disconnecting is a server action. */
export default function ConnectedAccounts({ providers = [], linked = [], notice = null }) {
  if (!providers.length) return null;

  const byProvider = new Map(linked.map((row) => [row.provider, row]));

  return (
    <div className="rounded-card border-[0.5px] border-line bg-white p-6">
      <p className="mb-4 text-[12px] leading-relaxed text-charcoal-soft">
        Connect an account to sign in with one tap. Your password keeps working either way — connecting one of these
        never replaces it.
      </p>

      {notice && (
        <p
          className={`mb-4 rounded-control px-3 py-2 text-[12px] font-medium ${
            notice.tone === "bad" ? "bg-rust-soft text-rust" : "bg-paper-deep text-charcoal"
          }`}
        >
          {notice.text}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {providers.map(({ id, label }) => (
          <ProviderRow key={id} id={id} label={label} row={byProvider.get(id)} />
        ))}
      </ul>
    </div>
  );
}

function ProviderRow({ id, label, row }) {
  const [state, formAction, pending] = useActionState(disconnectProvider, undefined);

  return (
    <li className="flex items-center gap-3 rounded-control border-[0.5px] border-line bg-paper px-3 py-2.5">
      <ProviderMark provider={id} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-charcoal">{label}</div>
        <div className="truncate text-[11px] text-charcoal-soft">
          {row ? row.email || "Connected" : "Not connected"}
        </div>
      </div>

      {row ? (
        <form action={formAction}>
          <input type="hidden" name="provider" value={id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-control border-[0.5px] border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep disabled:opacity-60"
          >
            {pending ? "…" : "Disconnect"}
          </button>
        </form>
      ) : (
        <a
          href={`/api/auth/${id}/start?link=1`}
          className="rounded-control bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-ink-deep"
        >
          Connect
        </a>
      )}

      {state?.error && <span className="text-[11px] font-medium text-rust">{state.error}</span>}
    </li>
  );
}
