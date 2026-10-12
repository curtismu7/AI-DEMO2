# Observability demo — presenter runbook

Two-part story: **forensics** (every agent action attributable) then **ops**
(agent traffic is just a monitored service). Part 1 is UC20 as shipped; part 2
is UC6 (Authz DENY) watched live in Grafana.

## Launch

```bash
./run.sh   # or: docker compose --profile observability --profile tracing up -d
```

Verify: `docker compose ps | grep -E "grafana|prometheus|loki|jaeger|alloy"` —
all Up. Grafana SSO requires the demo sign-in; the local fallback is
`http://localhost:3000` (admin / `ai-demo-grafana` unless `GRAFANA_ADMIN_PASSWORD`
is set). In k8s, Grafana lives under `<public_app_url>/grafana`.

## Part 1 — Forensics (~4 min)

1. Sign in as a customer (device-first unified sign-in).
2. Demo Steps → **UC20 Agent observability and traceability**, chip
   "show my balance" → PERMIT.
3. Walk the **Token Chain** panel: user-token → token-exchange →
   authorize-decision → tool-dispatched. Say: *who the agent was, who it acted
   for, what the policy decided — stamped on every event without
   application-layer instrumentation.*
4. Open **Transaction Trace** (Telemetry group) and show the same run as hops.
   The `═══` blocks in `${LOG_DIRECTORY}/demo-unified.log` are the file-based
   twin if you want to show raw evidence.

## Part 2 — Ops (~5 min)

5. Open the observability diagram: side nav → Telemetry → **Observability
   Demo** (or UC20's "Opens diagram" badge). Use the plane chips to show
   metrics / traces / logs as separate paths, then switch to **Demo
   walkthrough** — it mirrors the remaining steps.
6. SSO into **Grafana** (nav Telemetry → Grafana). Open the
   **Agent observability overview** dashboard.
7. Fire the live DENY: back in the agent, type *"transfer $2500 from checking
   to savings"* (UC6; amount adapts per vertical).
8. Within ~30s the DENY lands: "Decisions by outcome" ticks up, the live P1AZ
   log shows the DENY line, the DENY stat moves.
9. Close on **Alerting → Alert rules**: three rules, all ratio- or state-based.
   Explain why a 4xx is not automatically bad (RFC 9728 discovery challenge)
   and why thresholds are ratios, not counts.

## Fallbacks

- **Grafana empty / panels N/A:** check `up{job="pinggateway"}` panel ("Gateway
  metrics up") — if Down, the gateway admin connector isn't answering and every
  other panel is blind. `docker compose restart grafana` after any dashboard
  JSON edit (provisioning reads at startup).
- **Jaeger traces empty:** traces need the `tracing` profile; confirm
  `OTEL_EXPORTER_OTLP_ENDPOINT` reaches jaeger:4317.
- **No DENY visible:** the P1AZ decision logs ride Loki — check Loki is Up and
  the log panel's time range (default last 1h).

## Alert expectations — say this, don't promise more

A single DENY will **not** fire `McpDoorMostlyRejecting`: it needs >80% 4xx
for 10 minutes across ≥10 requests, by design — spec-following MCP clients
start with an unauthenticated request and read the RFC 9728 challenge, so 401s
are normal traffic. The live moment is the **dashboards reacting**; the alerts
page is explained, not awaited. UC18's rate-limit burst runs on the Node demo
gateway, not pinggateway, so it cannot trip these rules either. A 5xx or the
gateway metrics going down WOULD fire — `McpDoorServerError` and
`PingOneAgentGatewayMetricsDown` are unconditional — but those are failure
states, not demo beats.
