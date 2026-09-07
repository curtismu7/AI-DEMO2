#!/bin/sh
# OpenTelemetry entrypoint wrapper — Python analog of otel-instrument.js.
# No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset: opentelemetry-instrument
# itself does not no-op cleanly (it defaults to localhost:4317 and logs export
# failures), so this guard is what keeps the OFF state actually silent.
if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  exec opentelemetry-instrument "$@"
fi
exec "$@"
