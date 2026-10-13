# Audit evidence & compliance mappings — what the gateway actually emits

October 13, 2026 · reference (live-verified this date)

What a trainer can show for the audit close: the gateway stamps **every
AIGuard verdict and every policy denial** with structured compliance
mappings. This is measured from the live gateway log (tenant 0428ba4f,
v1.261009, catalog `aigw-compliance-v1.1.0`) — not from the deck.

Companion sources:
[`GATEWAY-LOGGING-WITH-ELASTICSEARCH.md`](GATEWAY-LOGGING-WITH-ELASTICSEARCH.md)
(the two feeds and how to ship them),
[`GATEWAY-GUARDRAILS-AND-THE-EXTERNAL-DETECTOR.md`](GATEWAY-GUARDRAILS-AND-THE-EXTERNAL-DETECTOR.md)
(where verdicts are logged),
[`docs/privilege-elasticsearch-kibana-runbook.md`](../docs/privilege-elasticsearch-kibana-runbook.md)
(ES/Kibana access).

## The three event types, verified live (2026-10-13, from `cyonproxy-2026-10-13T11-19-29.792.log`)

**1. `llm_request_blocked` (AIGuard, request side)** — an injection attempt
blocked before the provider:

| Field | Value from the live event |
|---|---|
| ComplianceMappings | `mitre_atlas AML.T0051` + `AML.T0056`, `nist_ai_rmf MAP-2.3` + `MEASURE-2.5`, `owasp_llm LLM01` + `LLM07` |
| Findings | `prompt_injection`, detector `inj-ignore-previous`, Score 0.9, Recommended block |
| Correlation | `RequestID`, `SpanID`, `TraceID` present — joins to the demo's trace view |
| Direction | `request` |

**2. `llm_response_sanitized` (AIGuard, response side)** — PII withheld
from a completion:

| Field | Value from the live event |
|---|---|
| ComplianceMappings | `mitre_atlas AML.T0057`, `nist_ai_rmf MEASURE-2.5`, `owasp_llm LLM02` (source `pii-email`) |
| Findings | 4–5 `pii` findings, Scores 0.5–0.85, Recommended sanitize |
| Direction | `response` |

**3. `llm_policy_response_denied` (AIPolicy, the attributable denial)** —
Cedar policy decides, not a detector:

| Field | Value from the live event |
|---|---|
| Decision / PolicyIDs | `deny` / `llm-response-pii-withhold:1` |
| Principal / AgentKey | `User::"03de8762…"` / `llama.cpp` |
| GrantShape | `transaction` |

Each event also carries `Tenant`, `User`, `VirtualKeyID`, and a top-level
`MITREATLASIDs` / `NISTAIRMFIDs` / `OWASPIDs` convenience array, and names
its catalog: `ComplianceCatalogSecurityVersion: aigw-compliance-v1.1.0`.

## Where to show each piece

| Question | Where | How |
|---|---|---|
| What did the guardrail block just now? | Gateway pod log | `kubectl -n ping-devops-cmuir exec <pod> -c log-tailer -- grep '"Event":"llm_request_blocked"' /var/log/procyon/cyonproxy-*.log` (AIGuard lines rotate with the log file) |
| Searchable history / dashboards | Elasticsearch `ping-siem-events` index | Ship the gateway log per the logging guide; query via Kibana (port-forward + OAuth2 proxy, per the runbook) |
| Who changed a policy or key? | SIEM console-audit feed (ES) | The feed records console changes, not traffic — the two-feed split in the logging guide |

## What is verified vs not

**Verified live 2026-10-13:** the three event types above, their field
shapes, and their compliance mappings, read from the gateway's own log
files. The MITRE ATLAS / NIST AI RMF / OWASP LLM identifiers are emitted by
the gateway itself under catalog `aigw-compliance-v1.1.0`.

**Not yet verified (do not quote as verified):**

- **The deck's slide-7 control framework** (Privilege-AIGuard deck,
  2026-09-22, on Drive): its control-to-event mapping table was not
  re-checked against this tenant. The gateway's *emitted* mappings above
  are real; the deck's *framework claims* need the tenant check before
  being presented as current.
- **Current contents of the `ping-siem-events` index** — the feed was
  tested 2026-10-03 and the runbook documents it, but today's index state
  was not queried (credential access was declined this session).

## Trainer line

"Every verdict names its frameworks — MITRE ATLAS, NIST AI RMF, OWASP LLM —
and every denial names the policy and the principal. If the audit can't
show it, it didn't happen."
