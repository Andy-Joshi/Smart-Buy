/**
 * Yahoo Request Rate-Limiting & Serialization Scheduler
 *
 * Yahoo search returns HTTP 500 when multiple requests from the same IP
 * are dispatched concurrently. This queue serializes requests to in.search.yahoo.com
 * with an enforced minimum stagger delay (280ms) between calls.
 */

let queue = Promise.resolve();

export function scheduleYahooRequest(fn, delayMs = 280) {
  const result = queue.then(async () => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return fn();
  });

  // Keep queue moving even if a request rejects
  queue = result.catch(() => {});
  return result;
}
