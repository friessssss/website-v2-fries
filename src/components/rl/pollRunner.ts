/** Runs `load` one at a time. A request() made mid-flight queues exactly one follow-up run. */
export function createPollRunner(load: (signal: AbortSignal) => Promise<void>) {
  let inFlight = false;
  let queued = false;
  let stopped = false;
  let controller: AbortController | undefined;

  async function request(): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      do {
        queued = false;
        controller = new AbortController();
        try {
          await load(controller.signal);
        } catch {
          // load reports its own errors
        }
      } while (queued && !stopped);
    } finally {
      inFlight = false;
    }
  }

  return {
    request,
    stop() {
      stopped = true;
      queued = false;
      controller?.abort();
    },
  };
}
