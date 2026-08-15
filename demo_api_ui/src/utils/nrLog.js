/**
 * Fire-and-forget New Relic log proxy.
 * POSTs to /api/nr-log which forwards to NR Logs API.
 * No-op when the endpoint returns an error — never throws.
 *
 * @param {string} message
 * @param {Record<string, unknown>} [attributes]
 */
export function nrLog(message, attributes = {}) {
  const correlationId =
    attributes.correlationId ||
    (typeof window !== 'undefined' ? window.__nrCorrelationId : null) ||
    null;
  fetch('/api/nr-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      message,
      attributes: {
        ...attributes,
        ...(correlationId ? { correlationId } : {}),
      },
    }),
  }).catch(() => {});
}
