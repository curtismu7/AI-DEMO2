# IDAI gap review — Agent Consent closure (2026-07-22)

Updates [PING_IDAI_SECURING_AGENTS_DIFF.md](../PING_IDAI_SECURING_AGENTS_DIFF.md) D1.

## Done

| Gap | Fix |
|-----|-----|
| PingOne Agreement “Agent Consent” | `demo_api_server/config/agentConsentAgreement.js` — copy from AgentConsentModal |
| Policy `Agent-Consent-Login` | LOGIN + AGREEMENT in `pingoneProvisionService.ensureAgentConsentLoginForApp` |
| Assign to User app | Bootstrap step `agent-consent` + `scripts/ensureAgentConsentAgreement.js` |
| Live env | Provisioned: agreement `295911ea-…`, policy `a4222053-…`, assignment created |

HITL / Phase 170 transfer consent **unchanged**.

## Verify

```bash
cd demo_api_server
npx jest src/__tests__/pingoneProvisionService.regression.test.js -t ensureAgentConsent
node scripts/ensureAgentConsentAgreement.js   # idempotent; needs worker + PINGONE_USER_CLIENT_ID
```

Customer login on User app should show Agreement Prompt once (then every 180 days / on revision).

## Still intentional / open

- **D2** AI Agents product console — keep WEB_APP
- **D6** Demo weakeners — lean/real flags for doc-faithful demos
