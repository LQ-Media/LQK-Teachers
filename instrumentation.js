// Runs once when the Next.js server boots (dev and standalone production).
// Starts the two background schedulers:
//   • azan push          — lib/azan/scheduler.js
//   • shift notifications — lib/hours/notify-scheduler.js
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAzanScheduler } = await import("./lib/azan/scheduler.js");
    startAzanScheduler();
    const { startShiftNotifications } = await import("./lib/hours/notify-scheduler.js");
    startShiftNotifications();
  }
}
