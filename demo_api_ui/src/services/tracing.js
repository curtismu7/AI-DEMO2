import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * Best-effort browser tracing, gated by the ff_tracing admin flag — the same
 * flag that gates every backend service's OTel export (see
 * scripts/otel-instrument.js / otel-python-entrypoint.sh). No-ops when the
 * flag is off or the flag check itself fails, exactly like the backend
 * services' env-gated no-op.
 *
 * Manual span creation only — no XHR/fetch auto-instrumentation. apiClient.js's
 * interceptors create one span per axios call and end it on settle, which is
 * both simpler than wiring a browser Zone.js context manager and gives the
 * exact hook needed to also set the X-Request-ID correlation header (see
 * apiClient.js) — so no separate instrumentation package is needed here.
 */

let started = false;

export async function initTracing() {
  if (started || typeof window === 'undefined') return;
  started = true;
  try {
    const res = await fetch('/api/admin/feature-flags', { credentials: 'include' });
    if (!res.ok) return;
    const { flags } = await res.json();
    const flag = (flags || []).find((f) => f.id === 'ff_tracing');
    const enabled = flag && (flag.value === true || flag.value === 'true');
    if (!enabled) return;

    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'demo-api-ui' }),
      spanProcessors: [
        new BatchSpanProcessor(new OTLPTraceExporter({ url: '/api/health/tracing/ingest' })),
      ],
    });
    provider.register();
  } catch {
    // Best-effort — tracing must never block or break the app.
  }
}
