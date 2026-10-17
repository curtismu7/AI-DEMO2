# Default delegation model: `act` only (no `may_act`)

Default since PR #1443. The user's token carries **no `may_act`**. Delegation is expressed with the RFC 8693 `act` claim only.

## How it works

- **Consent is a server-side grant record**, not a token claim. `POST /api/agent-authorization/grant` and `/revoke` write/clear a `delegationStore` record for the signed-in user and the AI Agent client (`demo_api_server/routes/agentAuthorization.js`, `services/agentConsent.js`). `GET /status` reads it.
- **PingOne Authorize checks the record on every tool call** (Rule 2.6 / `UserConsentMissing` and `UserConsentMismatch` in the policy; see [AUTHORIZATION_RULES.md](AUTHORIZATION_RULES.md)). Revoke takes effect on the next call: no re-login, no new token.
- **PingOne mints `act` at token exchange from the actor token**, not from the user's token. The audience-resource attribute is `${{'sub': #root.context.requestData.actorToken.client_id}}` (`pingoneProvisionService.actAttributeValue()`).
- **Provisioning skips** the `mayAct` user attribute and the `may_act` resource claim (`legacyMayActEnabled()` is false).

## Where `may_act` still applies

1. **Legacy mode**: feature flag `ff_may_act_seed` ON. Grant/revoke also write the user's PingOne `mayAct` attribute, `act` is seeded from `may_act`, and the SPA must silently re-auth after grant/revoke (`reauthRequired: true`).
2. **PingOne Advanced Identity Cloud (AIC)**.

The `PINGONE_MAY_ACT_*` setup guides describe these two cases only. For verification steps see [ACT_CLAIM_VERIFICATION.md](ACT_CLAIM_VERIFICATION.md).
