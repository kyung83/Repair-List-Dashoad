const TRANSIENT_ERROR_PATTERN = /\bD1_ERROR\b|storage operation exceeded timeout|object to be reset|temporarily unavailable|timed?\s*out|timeout/i;

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function waitForRetry(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError(signal));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function payloadError(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  return typeof payload.error === 'string' ? payload.error : '';
}

function responseLooksTransient(response, payload, readableJson) {
  if (!readableJson) return true;
  if (response.status >= 500) return true;
  return TRANSIENT_ERROR_PATTERN.test(payloadError(payload));
}

/**
 * Fetch JSON for idempotent browser reads. Retries transient/unreadable responses once by default
 * and replaces raw HTML/runtime/D1 errors with the supplied driver-safe message.
 */
export async function fetchJsonWithRetry(input, init = {}, options = {}) {
  const retries = Number.isInteger(options.retries) ? Math.max(0, options.retries) : 1;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? Math.max(0, options.retryDelayMs) : 200;
  const unavailableMessage = String(options.unavailableMessage || 'Service temporarily unavailable. Please try again.');
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') throw new Error(unavailableMessage);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (init.signal?.aborted) throw abortError(init.signal);

    try {
      const response = await fetchImpl(input, init);
      const body = await response.text();
      let payload = {};
      let readableJson = true;

      if (body.trim()) {
        try {
          payload = JSON.parse(body);
        } catch {
          readableJson = false;
        }
      }

      const transient = responseLooksTransient(response, payload, readableJson);
      if (transient && attempt < retries) {
        await waitForRetry(retryDelayMs, init.signal);
        continue;
      }
      if (transient) throw new Error(unavailableMessage);

      return { response, payload };
    } catch (error) {
      if (init.signal?.aborted || error?.name === 'AbortError') throw error;
      if (error instanceof Error && error.message === unavailableMessage) throw error;
      if (attempt < retries) {
        await waitForRetry(retryDelayMs, init.signal);
        continue;
      }
      throw new Error(unavailableMessage);
    }
  }

  throw new Error(unavailableMessage);
}
