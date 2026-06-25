/**
 * appEventClient.js — Fire-and-forget frontend event POST to BFF
 *
 * Posts app events to POST /api/admin/app-events without blocking UI.
 * Silently fails if the endpoint is unavailable or user is not authenticated.
 * Never throws. Never awaits in caller context (fire-and-forget).
 */

/**
 * Post an app event to the BFF activity log.
 * Non-blocking — do not await this function. Errors are silently swallowed.
 *
 * @param {string} category - Event category (must match appEventService EVENT_CATEGORIES)
 * @param {string} severity - 'info' | 'warning' | 'error'
 * @param {string} message - Human-readable event message
 * @param {object} [options] - Optional tag and metadata
 * @param {string} [options.tag] - Dot-path tag (e.g. 'agent/processing-start')
 * @param {object} [options.metadata] - Structured metadata (no secrets)
 */
async function postAppEvent(category, severity, message, options = {}) {
  try {
    await fetch('/api/admin/app-events', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category,
        severity,
        message,
        tag: options.tag || null,
        metadata: options.metadata || null,
      }),
    });
  } catch (e) {
    // Silently fail — logging infrastructure must never block UX
    console.debug('[appEventClient] POST /admin/app-events failed:', e.message);
  }
}

export { postAppEvent };
