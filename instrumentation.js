// Runs once when the Next.js server boots (dev and standalone production).
// Starts the azan push scheduler — see lib/azan/scheduler.js.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAzanScheduler } = await import("./lib/azan/scheduler.js");
    startAzanScheduler();
  }
}
