'use strict';

/**
 * observabilityUrls — where the observability UIs live, per deployment.
 *
 * There is no single URL that works in both targets: Grafana sits under
 * /grafana on the app's own origin in k8s (nginx proxies it), and on its own
 * port in Docker Compose, which is a DIFFERENT origin from the UI. Emitting the
 * k8s form everywhere is what made /grafana a 404 on a local stack.
 *
 * Lifted out of routes/tracing.js so the tracing route and the control-plane
 * overview cannot disagree about it. TRACES_UI_URL wins when set — Compose sets
 * it to http://localhost:3000 precisely because the derived form is wrong there.
 */

const configStore = require('./configStore');

/** Grafana's browser URL. Env first, then derived from the public app origin. */
function tracesUiUrl() {
  const publicAppUrl = String(configStore.getEffective('public_app_url') || '').trim();
  const derived = publicAppUrl ? `${publicAppUrl}/grafana` : 'http://localhost:3000';
  return (process.env.TRACES_UI_URL || derived).replace(/\/$/, '');
}

/**
 * Jaeger's browser URL, or null when nothing declares one.
 *
 * Deliberately has no derived fallback: JAEGER_QUERY_URL is a server-side
 * address (http://jaeger:16686 inside the compose network) and is not reachable
 * from a browser, so guessing from it would produce a link that always fails.
 * A null here renders as plain text rather than a broken link.
 */
function jaegerUiUrl() {
  const raw = String(process.env.JAEGER_UI_URL || '').trim();
  return raw ? raw.replace(/\/$/, '') : null;
}

module.exports = { tracesUiUrl, jaegerUiUrl };
