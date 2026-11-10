/**
 * Yahoo Request Rate-Limiting & Serialization Scheduler
 *
 * Yahoo search returns HTTP 500 when multiple requests from the same IP
 * are dispatched concurrently. This queue serializes requests to in.search.yahoo.com
 * with an enforced minimum stagger delay (280ms) between calls.
 */

let queue = Promise.resolve();

export function scheduleYahooRequest(fn, delayMs = 450) {
  const result = queue.then(async () => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const isTransient =
          err.message && (err.message.includes('500') || err.message.includes('429'));
        if (isTransient && attempt < 2) {
          const waitTime = (attempt + 1) * 1200;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  });

  // Keep queue moving even if a request rejects
  queue = result.catch(() => {});
  return result;
}
