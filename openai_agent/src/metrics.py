"""OpenTelemetry metrics for the OpenAI agent (this service, openai_agent).

Prefixed `openaiagent_`, matching demo_mcp_gateway's `mcpgw_` convention
(prom-client there, OTel Metrics API here — both still end up scraped by
Prometheus the same way, see monitoring/prometheus.yml).

Deliberately does NOT touch _stream's control flow, error handling, or
yielded events — run_handler.py wraps the existing generator with pure
observation (record on settle, re-raise unchanged). Note: _stream's own
try/except swallows agent/tool/LLM errors into an AG-UI RUN_ERROR SSE
event rather than raising, so openaiagent_run_errors_total only counts
something escaping that except entirely — not agent-level failures, which
the run always reports as a "successful" HTTP response.
"""

import os

from opentelemetry.exporter.prometheus import PrometheusMetricReader
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource

# PrometheusMetricReader self-registers into prometheus_client's default
# global REGISTRY, so main.py's /metrics route can serve it with a plain
# prometheus_client.generate_latest() call — no second exporter-owned server.
_resource = Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "openai-agent")})
_reader = PrometheusMetricReader()
_provider = MeterProvider(metric_readers=[_reader], resource=_resource)
_meter = _provider.get_meter("openai-agent")

run_duration = _meter.create_histogram(
    "openaiagent_run_duration_seconds",
    unit="s",
    description="Duration of /run agent invocations",
)

run_errors = _meter.create_counter(
    "openaiagent_run_errors_total",
    description="Agent runs that raised before _stream's own error handling could respond",
)
