"""OpenTelemetry metrics for the LangChain agent (this service, langchain_agent).

Prefixed `langchainagent_`, matching demo_mcp_gateway's `mcpgw_` convention
(prom-client there, OTel Metrics API here — both still end up scraped by
Prometheus the same way, see monitoring/prometheus.yml).

Deliberately does NOT touch _run_stream's control flow, error handling, or
yielded events — agui_run_handler.py wraps the existing generator with pure
observation (record on settle, re-raise unchanged). Note: _invoke_agent's own
try/except swallows agent/tool/LLM errors into an AG-UI RUN_ERROR SSE event
rather than raising, so langchainagent_run_errors_total only counts something
escaping that except entirely — not agent-level failures, which the run
always reports as a "successful" HTTP response.
"""

import os

from opentelemetry.exporter.prometheus import PrometheusMetricReader
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource

# PrometheusMetricReader self-registers into prometheus_client's default
# global REGISTRY, so main.py's /metrics route can serve it with a plain
# prometheus_client.generate_latest() call — no second exporter-owned server.
_resource = Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "langchain-agent")})
_reader = PrometheusMetricReader()
_provider = MeterProvider(metric_readers=[_reader], resource=_resource)
_meter = _provider.get_meter("langchain-agent")

run_duration = _meter.create_histogram(
    "langchainagent_run_duration_seconds",
    unit="s",
    description="Duration of /run agent invocations",
)

run_errors = _meter.create_counter(
    "langchainagent_run_errors_total",
    description="Agent runs that raised before _invoke_agent's own error handling could respond",
)
