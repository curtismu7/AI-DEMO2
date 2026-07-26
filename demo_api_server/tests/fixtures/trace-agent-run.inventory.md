# Span inventory — trace-agent-run.json

| service | operation |
|---|---|
| agent-service | POST |
| agent-service | POST /run |
| agent-service | agent-run-request |
| agent-service | dns.lookup |
| agent-service | middleware - expressInit |
| agent-service | middleware - query |
| agent-service | reasoning-step-1 |
| agent-service | reasoning-step-2 |
| agent-service | reasoning-step-3 |
| agent-service | reasoning-step-4 |
| agent-service | reasoning-step-5 |
| agent-service | reasoning-step-6 |
| agent-service | request handler - /run |
| agent-service | tcp.connect |
| agent-service | tls.connect |
| agent-service | tool-execution |

## trace-chip-run.json

| service | operation |
|---|---|
| authz-server | GET |
| authz-server | POST |
| authz-server | POST /as/introspect |
| authz-server | POST /governance/pap/alpha/policy/:workerId/decision |
| authz-server | dns.lookup |
| authz-server | middleware - correlationId |
| authz-server | middleware - corsMiddleware |
| authz-server | middleware - expressInit |
| authz-server | middleware - jsonParser |
| authz-server | middleware - query |
| authz-server | middleware - urlencodedParser |
| authz-server | request handler - /as/introspect |
| authz-server | request handler - /governance/pap/alpha/policy/:workerId/decision |
| authz-server | tcp.connect |
| authz-server | tls.connect |
| demo-api-server | POST |
| demo-api-server | POST /api/agent/invoke |
| demo-api-server | dns.lookup |
| demo-api-server | middleware - <anonymous> |
| demo-api-server | middleware - correlationIdMiddleware |
| demo-api-server | middleware - corsMiddleware |
| demo-api-server | middleware - delegationAuditMiddleware |
| demo-api-server | middleware - delegationGate |
| demo-api-server | middleware - expressInit |
| demo-api-server | middleware - helmetMiddleware |
| demo-api-server | middleware - jsonParser |
| demo-api-server | middleware - logActivity |
| demo-api-server | middleware - logger |
| demo-api-server | middleware - query |
| demo-api-server | middleware - restoreSessionFromCookie |
| demo-api-server | middleware - session |
| demo-api-server | middleware - timingMiddleware |
| demo-api-server | middleware - urlencodedParser |
| demo-api-server | request handler - /api/agent/invoke |
| demo-api-server | router - /agent/invoke |
| demo-api-server | router - /authorize-intent |
| demo-api-server | router - /delegate |
| demo-api-server | router - /identity/status |
| demo-api-server | tcp.connect |
| mcp-gateway | GET |
| mcp-gateway | POST |
| mcp-gateway | dns.lookup |
| mcp-gateway | tcp.connect |
| mcp-gateway | tls.connect |
| mcp-server | POST |
