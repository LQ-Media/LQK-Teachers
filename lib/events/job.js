import "server-only";
import { nextPendingRecipient, countPending, markEventSent, getEvent } from "./store.js";
import { deliverToRecipient, SEND_DELAY_MS } from "./send.js";

// Background send.
//
// A 1,000-parent invite takes roughly 15 minutes at the throttle Google and
// WATI are comfortable with. Driving that from the browser — the obvious first
// design — means the operator must keep a tab open and awake for the whole
// send, and a closed laptop lid stops it halfway with no indication to the
// parents who were never reached. So the loop lives here, on the server, and
// the browser only watches.
//
// Deliberately in-process rather than a queue or a cron: the service runs as a
// single replica (see the Railway service config), and a real job queue would
// mean another dependency and another thing to operate for one button. The
// trade-offs that buys are handled explicitly:
//
//   - Two sends of the same event can't overlap — `running` is checked before
//     a job starts, and every recipient's outcome is written to its own row.
//   - A restart mid-send loses only the in-memory progress counter, never the
//     record: anyone already sent to is marked `sent`, so pressing Send again
//     resumes with whoever is still `pending` and never messages a parent
//     twice.

const jobs = new Map(); // eventId -> state

// Never loop forever, whatever the data does. 4,000 parents at the default
// throttle is already well past anything this centre will send.
const MAX_ROUNDS = 4000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function jobState(eventId) {
  const state = jobs.get(eventId);
  if (!state) return { running: false, startedAt: null, sent: 0, failed: 0, error: null };
  return {
    running: state.running,
    startedAt: state.startedAt,
    sent: state.sent,
    failed: state.failed,
    error: state.error,
  };
}

export function isRunning(eventId) {
  return Boolean(jobs.get(eventId)?.running);
}

/**
 * Start delivering an event in the background. Returns immediately.
 *
 * Re-entrant by design: calling it while a job is running is a no-op, and
 * calling it after one finished picks up anyone still pending (a retry after
 * fixing SMTP credentials, say).
 */
export function startSendJob(eventId, channels) {
  if (isRunning(eventId)) return jobState(eventId);

  const state = {
    running: true,
    startedAt: new Date().toISOString(),
    sent: 0,
    failed: 0,
    error: null,
  };
  jobs.set(eventId, state);

  // Intentionally not awaited — the caller returns to the browser at once.
  (async () => {
    try {
      // The event is read once: its wording and design are fixed for the run,
      // and re-reading it per parent would be a query each time for nothing.
      // Recipients, by contrast, ARE re-queried each iteration — an admin may hit
      // "retry failed" alongside, so the rows stay the source of truth.
      const event = getEvent(eventId);
      if (!event) throw new Error("That event no longer exists.");

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const next = nextPendingRecipient(eventId, channels);
        if (!next) break;

        const result = await deliverToRecipient(event, next, { channels });
        const outcomes = [result.email, result.whatsapp].filter(Boolean);
        if (outcomes.includes("failed")) state.failed += 1;
        if (outcomes.includes("sent")) state.sent += 1;

        // Guard against a recipient that somehow stays pending — without this
        // a single stuck row would spin the loop until MAX_ROUNDS.
        if (!outcomes.length) break;

        if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
      }

      if (countPending(eventId, channels) === 0) markEventSent(eventId);
    } catch (err) {
      // A crash here must not take the server down — the job is detached, so
      // an unhandled rejection would be fatal in some Node configurations.
      state.error = err?.message || String(err);
    } finally {
      state.running = false;
    }
  })();

  return jobState(eventId);
}
