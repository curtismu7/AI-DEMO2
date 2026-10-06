# PingFederate capability spike: draft-oauth-ai-agents-on-behalf-of-user-02

Status: **interim**. Read-only discovery plus unauthenticated authorize probes against the local PF 13.1.2.0 (2026-10-06). Nothing on PF was changed. R3-R6 are still unproven because proving them means creating objects on the live PF.

| ID | Verdict so far | Evidence |
|---|---|---|
| R1 `requested_actor` accepted, required | NOT ENFORCED today, FEASIBLE by config | `/as/authorization.oauth2` returns 200 for no actor, `agent-a` and `nobody` alike: PF ignores the parameter. PF ships `HttpRequestParamAuthnSelector`, and the repo already uses it on `acr_values` (`aiDemoPfAcrSelector`, `trackedHttpParameters: ["acr_values"]`). A selector on `requested_actor` with `Not in Request` -> Fail makes it required. |
| R2 reject unknown actor | FEASIBLE by config (untested) | Same selector: one result value per recognised actor, `No Match` -> Fail. Needs a live test that Fail yields an authorize error to the client rather than an error page. |
| R3 code bound to user+client+actor | UNPROVEN | Needs the actor carried from the policy into a persistent-grant extended attribute through an access-token mapping. Not yet tried. |
| R4/R5 `actor_token` required, `sub` must equal bound actor | UNPROVEN, likely the hard one | Hypothesis: an access-token-mapping expression can read the token request via `context.HttpRequest`. Even then it can only copy the parameter, not validate it as a JWT and compare `sub`. Probably NEEDS-PLUGIN. Existing mapping already builds `act` with an expression (`#{"sub": ..., "act": ...}`), so emitting is easy, validating is not. |
| R6 `act.sub` in access token | PASS for the exchange path today | `/oauth/accessTokenMappings` already fulfils `act` from an EXPRESSION in the token-exchange mapping. The auth-code path is untested. |

## Apply attempt 1 (2026-10-06, run by the user): policy rejected, fully reverted

Selector `POST` returned 201; the `PUT` of the policy returned 422 and the policy was untouched. `--revert` restored the backup and deleted the selector (200, 204). PF's rules, from the validation errors:

- Every result value the selector exposes (`Not in Request`, `No Match`) needs a child (`authn_policy_tree_context_missing_for_authn_selector_configuration`).
- A selector's child cannot be `DONE` (`authn_selection_action_type_not_allowed`), so "No Match -> reject" cannot be expressed as a bare Fail; it needs a real source/contract node.
- Consequence for R1/R2: a **new first tree cannot fall through** for requests without `requested_actor`; it must also re-implement the normal login (form plus the MFA branch). Touching shared login this way is high risk. Safer shapes: nest the actor selector under the existing tree's `Not in Request` / `No Match` branches, or scope by client with `OAuthClientAdapterSelector`, or reject in a custom adapter/plugin.
- The docs say a policy can "deny the request" but do not say which node does it; confirm on an isolated PF.

Net: R1/R2 are **FEASIBLE but not config-only-simple**; the authorize-time reject probably wants a small adapter or an isolated client-scoped tree. Still open: R3, R5.

## Next (needs a go-ahead because it creates objects on the live PF)

1. Throwaway selector `actorDraftSelector` on `requested_actor` plus a branch in a **separate** policy (do not edit `default`, which carries the `acr_values` MFA tree).
2. Re-run `authz-probe`: unknown actor must fail, missing must fail.
3. Throwaway client plus a mapping to test R3 and R5 for real; decide policy-only versus plugin.
