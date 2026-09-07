import ProviderMark from "./ProviderMark";

/* The social sign-in buttons on the login page.

   Plain links, not buttons with an onClick: starting the flow is a GET to
   /api/auth/<provider>/start, which sets the state cookie and 302s onwards. No
   client JavaScript is involved, so these work even if the bundle hasn't loaded.

   `providers` is whatever is actually configured — see enabledProviders() in
   lib/auth/providers.js. When nothing is configured this renders nothing at all,
   which is why the portal today looks exactly as it did before. */
export default function SocialSignIn({ providers = [] }) {
  if (!providers.length) return null;

  return (
    <div className="mb-4">
      <div className="flex flex-col gap-2">
        {providers.map(({ id, label }) => (
          <a
            key={id}
            href={`/api/auth/${id}/start`}
            className="flex items-center justify-center gap-2.5 rounded-control border-[0.5px] border-line bg-white px-[18px] py-[10px] text-[13px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
          >
            <ProviderMark provider={id} />
            Continue with {label}
          </a>
        ))}
      </div>

      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-soft">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
