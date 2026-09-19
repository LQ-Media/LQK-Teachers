/* The three brand marks, inline. Each provider's sign-in guidelines require
   their own logo on the button, and inlining them keeps the login page to a
   single request — it is the one page that has to work on a bad connection in a
   car park before class. */
export default function ProviderMark({ provider, className = "h-[18px] w-[18px]" }) {
  if (provider === "google") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.08 7.94-2.92l-3.88-3a7.2 7.2 0 0 1-10.72-3.78H1.34v3.09A12 12 0 0 0 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.34 14.3a7.19 7.19 0 0 1 0-4.6V6.61H1.34a12 12 0 0 0 0 10.78l4-3.09Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.16 15.24 0 12 0A12 12 0 0 0 1.34 6.61l4 3.09A7.16 7.16 0 0 1 12 4.75Z"
        />
      </svg>
    );
  }

  if (provider === "apple") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
        <path d="M17.05 12.79c-.03-2.75 2.25-4.07 2.35-4.13-1.28-1.87-3.27-2.13-3.98-2.16-1.69-.17-3.31 1-4.16 1-.86 0-2.18-.98-3.59-.95-1.85.03-3.55 1.07-4.5 2.72-1.92 3.33-.49 8.25 1.38 10.95.91 1.32 2 2.8 3.42 2.75 1.37-.06 1.89-.89 3.55-.89 1.65 0 2.12.89 3.57.86 1.47-.02 2.41-1.34 3.31-2.67 1.04-1.53 1.47-3.01 1.5-3.09-.03-.01-2.88-1.1-2.91-4.39ZM14.33 4.7c.75-.91 1.26-2.18 1.12-3.44-1.08.04-2.39.72-3.17 1.63-.7.8-1.31 2.09-1.15 3.32 1.21.09 2.44-.61 3.2-1.51Z" />
      </svg>
    );
  }

  if (provider === "microsoft") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path fill="#F25022" d="M2 2h9.5v9.5H2Z" />
        <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5Z" />
        <path fill="#00A4EF" d="M2 12.5h9.5V22H2Z" />
        <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5Z" />
      </svg>
    );
  }

  return null;
}
