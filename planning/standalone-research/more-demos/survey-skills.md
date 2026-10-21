# Survey: skills, docs, runbooks, scripts (candidates beyond the 94-item catalog)

Root for relative paths: /Users/cmuir/Development/AI-DEMO2 (call it REPO). Read-only survey. Paths marked ok were checked with ls. Anything about Ping product behaviour that did not come from a file is marked "own knowledge" or UNVERIFIED. Nothing was executed.

What was read: claudSkills tree and SKILL.md descriptions, se-skills-export README and descriptions, .claude/skills descriptions (32 project skills, more than the two folders named in the brief), ~/.claude/skills (par, pingcli-demo-page, pingone-mcp, pingone-sample-apps), headers of ~60 scripts, docs listing and headers of about 12 docs, standalone/ listing, catalog tables. Not found: /Users/cmuir/Development/pingfederate-skill (does not exist). se-skill-catalog/skills holds zip/md copies of the same skills as se-skills-export.

## Candidates

### S1. PingOne tenant bootstrap CLI (Tool, size M, value 5, overlap: none; base "setup" 0.9 covers app-registration only for the demo itself)
Story: an SE with an empty sandbox needs a working PingOne environment (resource servers, scopes, apps, users, groups) in one command instead of console clicking; obstacle is hand-built tenants drift and nobody knows what "ready" means; control = Management API worker app.
Seeds: demo_api_server/scripts/bootstrapPingOne.js (header says non-browser variant of /setup/wizard), demo_api_server/services/pingoneProvisionService.js (4212 lines, too big to lift whole), demo_api_server/scripts/setupFresh.js, scripts/pingone-bootstrap.js, docs/SETUP_AUTOMATION_PLAN.md, docs/editions/fresh-environment-gaps.md (audit of an empty tenant; notes a prior bootstrap run was blocked by a permission classifier, so the script was never observed against the clean tenant), demo_api_server/scripts/provisionVerticalGroups.js.
Needs: live PingOne tenant (no mock). Risk: the monolith provisioner is large; extract only a recipe-driven subset. Hard-coded environment IDs exist in the fresh-environment doc and in cleanup script (strip them).

### S2. PingOne app inventory and tenant cleaner (Tool, S, value 4, overlap: none)
Story: an SE's shared sandbox has dozens of stale demo apps; goal is list, classify (agent vs normal) and delete safely with a keep-list; obstacle is fear of deleting the wrong thing; control = Management API.
Seeds: scripts/cleanup-pingone-apps.sh (hard-codes one environment ID and a KEEPER list; must be parameterised), scripts/pingone-audit-249.js, demo_api_server/scripts/describeApp.js (prints one app, never a secret), docs/pingone-ai-agents-migration-plan.md (classifies which apps are AI agents), docs/pingone-app-organization.md.
Needs: live tenant. Dry-run default is a must.

### S3. Scope / audience / grant matrix verifier (Tool, S-M, value 4, overlap: C19 partial, B8 no)
Story: "why is my token missing scope X or aud Y": compare what resources, scopes and app grants exist in the tenant to an expected matrix, name the gap.
Seeds: demo_api_server/scripts/verify-scope-configuration.js, scripts/check-resource-server-audience-drift.js, scripts/check-tool-scope-registration.js, docs/PINGONE_APP_SCOPE_MATRIX.md, docs/PINGONE_RESOURCES_AND_SCOPES_MATRIX.md, docs/SCOPE_AUDIENCE_MAPPING.md, scripts/sync-gateway-scope-topology.js.
Needs: live tenant (read-only worker).

### S4. Worker-app role doctor (Tool, S, value 3, overlap: base `doctor` 0.7 partial)
Story: Management API calls return 401/403/406/415; tool tells which role/permission the worker app lacks and the right header.
Seeds: scripts/pingfederate/list-pingone-gateway-roles.js, scripts/smoke-pingone-mcp.js, ~/.claude/skills/pingone-sample-apps/SKILL.md (names 401/403/406/415 traps and custom-admin-role), ~/.claude/skills/pingone-mcp/SKILL.md, claudSkills/pingone/pingone-api-calls.
Needs: live tenant. Good first feature of the base `doctor`; may belong in the base rather than a repo.

### S5. Tenant snapshot and diff (Tool, M, value 3, overlap: B8 policy drift (policy only), A13 no)
Story: export apps, resources, scopes, policies to JSON, diff two tenants or two points in time.
Seeds: demo_api_server/scripts/exportBootstrapData.js, exportMigrationBundle.js, importMigrationBundle.js, verifySnapshotParity.js, verifyAuthorizeCloudParity.js, scripts/check-pac-policy-drift.js, scripts/lib/rotationTargets.js.
Needs: live tenant. Caveat from verifyAuthorizeCloudParity.js header: there is no API to import or evaluate a P1AZ policy, so P1AZ is compare-only.

### S6. Client-secret rotation helper (Tool, M, value 2, overlap: none)
Story: rotate one PingOne client secret and propagate to env/vault without breaking the running stack.
Seeds: scripts/rotate-app-secret.js (detached so it survives container recreate), scripts/lib/rotateAppSecretCli.js, demo_api_server/scripts/rotateClientSecret.js, scripts/vault-audit.js.
Needs: live tenant plus a vault. Tied to this repo's vault; low reuse, listed for completeness.

### S7. PingCLI command playground (Demo, S, value 3, overlap: none)
Story: show customers that PingOne config is scriptable: pick a pingcli command from an allow-list, see the string, run it live, see output in a terminal pane.
Seeds: ~/.claude/skills/pingcli-demo-page/SKILL.md, demo_api_server/routes/pingcli.js (363 lines; allow-listed proxy, handles HOME and env-stripping gotchas). UI component is in banking_ui (not located; UNVERIFIED).
Needs: live tenant (pingcli auth); no mock unless output is canned.

### S8. PingOne MCP connect and admin-plane smoke (Tool/Tester, S, value 3, overlap: C17 (API explorer with MCP-first rule))
Story: connect Cursor / VS Code / Claude Code to the hosted PingOne MCP server, create the Worker app, prove it with a smoke check.
Seeds: ~/.claude/skills/pingone-mcp/SKILL.md, se-skills-export/pingone-mcp-connect/SKILL.md, claudSkills/pingone/pingone-mcp-install, scripts/smoke-pingone-mcp.js.
Treat as a feature of C17 unless it is shipped as a standalone installer. Included for visibility.

### S9. Bedrock AgentCore + PingOne agent (Demo, M, value 4, overlap: none)
Story: an agent hosted on AWS Bedrock AgentCore Runtime authenticates with PingOne, both M2M and user-federated (3LO).
Seeds: se-skills-export/bedrock-agentcore-pingone/SKILL.md (and a references/ dir in se-skill-catalog/skills/bedrock-agentcore-pingone).
Needs: live AWS account plus PingOne; hard to mock. No code in the repo beyond the skill (UNVERIFIED that any runnable sample exists).

### S10. PingFederate in a box (Tool, M, value 4, overlap: base setup option "PF"; A15 partial)
Story: a clean local PF 13.x with licence check, ports, Java, admin console readiness and base config in one command.
Seeds: se-skills-export/pingfederate-install/SKILL.md, scripts/pingfederate/docker-compose.fresh.yml, docker-compose.local.yml, scripts/pingfederate/ensure-se-pingfederate.sh, docs/editions/pf-baseline.md, scripts/pingfederate/provision-all.sh, provision-core.js.
Needs: PF licence and image access (own knowledge: PF images need a DevOps user/key; UNVERIFIED in files). Includes a licence/limits checker idea: parse the licence file for expiry and connection limits (own knowledge, no code exists).

### S11. PF + PingOne MFA wiring kit (Demo, M, value 4, overlap: A1 MFA tester, A15)
Story: customers with PingFederate want PingOne MFA (OTP, FIDO2, passwordless, step-up) without replacing PF; goal is wire connection, adapter, policy and see all three flows.
Seeds: scripts/pingfederate/create-pingone-connection.js, create-pingone-mfa-adapter.js, list-pingone-mfa-inputs.js, enable-pf-mfa-step-up.js, enable-pf-passwordless.js (+ test), provision-pf-pingone-user-gate.sh, scripts/test-mfa.js, docs/MFA_TEST_PLAN.md, docs/PINGFEDERATE_MFA_STATUS.md, spiffe/pingfederate/pf-pingone-user-gate.json.
Needs: live PF + PingOne MFA. Distinct from A1 because the point is the PF wiring, not the factor list.

### S12. PF theming / branded login (Skin, S, value 2, overlap: A21 Branding)
Seeds: scripts/pingfederate/apply-login-theme.sh (+ test), scripts/pingfederate/assets/login-theme-*.css, html.form.login.template.html, pingone-mfa-theme.css. Better as an A21 seed, not new.

### S13. SAML assertion to ID-JAG bridge (Demo, M, value 4, overlap: C1 ID-JAG, A16 SAML lab)
Story: an enterprise only has SAML SSO; goal is to trade that assertion for an ID-JAG in one exchange to call an MCP/API; obstacle is IdP lacks ID-JAG; control = PF token exchange.
Seeds: scripts/pingfederate/configure-saml-idjag.js, scripts/saml-live-setup.sh (owner-run phases), scripts/pingfederate/configure-acme-idp.js (outside-company IdP), scripts/pingfederate/sync-id-jag-trusted-idps.js, scripts/id-jag/outside-agent.js, se-skills-export/pingfederate-id-jag/SKILL.md, .claude/skills/creating-pingfederate-id-jag-resource-server/SKILL.md.
Needs: PF 13.1+. Likely a mode of C1 instead of its own repo; flagged.

### S14. P1AZ plain-language policy generator and offline deny predictor (Tool, M, value 4, overlap: B1, B2)
Story: SE types "deny if amount over 2000, step-up over 500" and gets an importable PingOne Authorize snapshot, then an offline evaluator tells which deny rules would fire; obstacle: no API to import or evaluate, so the loop is edit, import, publish, replay.
Seeds: se-skills-export/p1az-import-generator/SKILL.md and reference/example-import.snapshot.json, scripts/predict-p1az-denies.mjs, demo_api_server/scripts/verifySnapshotParity.js, docs/P1AZ_TOKENACTIVE_RULE_SETUP.md, docs/PINGONE_AUTHORIZE_SETUP_GUIDE.md.
Needs: no tenant for generate/predict (mock-able); live only for import (manual by console).

### S15. P1AZ policy tree walker / EA Admin API builder (Tool, S-M, value 3, overlap: B1, B2)
Seeds: se-skills-export/pingone-authorize-ea-api-build/SKILL.md and scripts/walk_policy_tree.py, .claude/skills/pingone-authorize-ea-api-build. Early-access API; UNVERIFIED that it is stable.

### S16. PingAuthorize AAM / sideband lab (Demo, M, value 3, overlap: A19 PingGateway lab, B1)
Seeds: se-skills-export/pingauthorize-aam-ai-demo/SKILL.md, docs/pingauthorize-policy-parity.md, docs/pingauthorize-tier-parity.md, docs/p1az-vs-gateway-token-checks.md, scripts/verify-pinggateway-parity.js, docs/pinggateway-agent-plan.md. Mostly an A19/B1 seed; listed as overlap.

### S17. PingID MFA demo (Demo, S-M, value 2, overlap: A1 MFA tester (PingOne MFA only))
Story: PingID enrollment and authentication policy via an IdP.
Seeds: se-skills-export/pingid-ai-demo/SKILL.md only; no runnable code found. Needs PingID tenant. Low confidence.

### S18. PingDirectory / PingAccess skill-seeded labs (Demo, M each, value 3, overlap: A17, A18, both marked "no seed" in the catalog)
Update to catalog: seeds now exist as skills: se-skills-export/pingdirectory-ai-demo/SKILL.md, se-skills-export/pingaccess-ai-demo/SKILL.md. Skills only; no containers or code checked.

### S19. Postman / Bruno collection pack with generated environment (Tool, S, value 3, overlap: none)
Story: SE hands a customer a ready collection: pi.flow auth code, 1- and 2-exchange delegated chain, MFA v4, MCP tools, with the environment file generated from setup output.
Seeds: postman/PingOne Authorization Code — pi.flow.postman_collection.json, postman/The-AI-Demo-PingOne-Test.postman_collection.json, docs/The AI Demo — 1-Exchange Delegated Chain — pi.flow.postman_collection.json, docs/The AI Demo — 2-Exchange Delegated Chain — pi.flow.postman_collection.json, docs/The-AI-Demo-Advanced-Utilities.postman_collection.json, docs/PingOne Authentication v4 - MFA included.postman_collection.json, docs/The-AI-Demo-Shared.postman_environment.json. Check collections for embedded secrets before reuse.

### S20. Delegation-chain hop tracer (Tool, M, value 3, overlap: C6 OBO, F1 trace, C3 inspector)
Story: drive one real session through BFF, RFC 8693 exchange, gateway, authorize, MCP server and dump aud/sub/scope/act at every hop.
Seeds: demo_api_server/scripts/tokenChainTrace.js, verify-act-claims.js, verify-token-exchange.js, setupTratClaims.js, docs/ACT_CLAIM_VERIFICATION.md, docs/TOKEN_FLOW.md. Overlap heavy; best as a seed for F1/C6.

### S21. Transaction-token (TraT) and intent-binding demo (Demo, M, value 3, overlap: none in catalog; B9 and C6 adjacent)
Story: bind an agent action to a signed transaction intent so a token cannot be replayed for a different amount/payee; obstacle: tokens say who, not what for; control = token policy claims (reqctx, purp, azd, rctx) plus Authorize.
Seeds: demo_api_server/scripts/setupTratClaims.js, docs/TRANSACTION-TOKEN-RFC-SUMMARY.md (says drafts only, not RFCs), docs/TX-AT-TOKEN-MODEL.md, docs/INTENT_AUTHORIZATION_GUIDE.md, demo_api_server/routes/intentBinding.js, intentAuthRoute.js, docs/reports/trusted-agent-transactions-5-steps-2026-09-30.md. Standards status is from the file, must be re-verified before a customer sees it.

### S22. OAuth teaching agent (Demo, M, value 3, overlap: C-group is "teaching tools" generally; none specific)
Seeds: .claude/skills/oauth-teaching-agent/SKILL.md, docs/OAUTH_TEACHING_AGENT_PLAN.md, docs/AI_TOKENS_EDUCATION.md. Code location not confirmed (UNVERIFIED).

### S23. Agent red-team and routing eval harness (Tester, M, value 3, overlap: D8, D12)
Story: run a promptfoo suite of attacks and routing checks against any agent endpoint, signed in, with pass/fail.
Seeds: demo_api_server/promptfoo/agent-eval.yaml, redteam-eval.yaml, auth-cookie.js, demo_api_server/scripts/promptfoo-eval-authed.sh, promptfoo-step-narration.sh, demo_api_server/scripts/healthcareRoutingEval.js, demo_api_server/scripts/intentPacks/routingEval.js, docs/privilege-aiguard-training.md.
Needs: an agent endpoint (mock-able with the hostile standalone servers).

### S24. Guardrail verdict live feed (Tool, S, value 3, overlap: D12 AI Guard, D13)
Story: on the LLM path the caller only sees a block; Alert and Sanitize verdicts are invisible; tail them live for the audience.
Seeds: scripts/gateway-verdict-feed.sh. Needs Privilege gateway.

### S25. Privilege console probe / agent-app debugger (Tool, S, value 3, overlap: D1, D11)
Seeds: scripts/privilege-console-probe.mjs (+ test), .claude/skills/privilege-console-api, privilege-new-demo-environment, privilege-mcpgw-agent-k8s. Reads what the control plane thinks of an Agentic App.

### S26. Gateway A/B behaviour parity harness (Tester, M, value 2, overlap: D1)
Seeds: scripts/gateway-parity-harness.js, scripts/verify-pinggateway-parity.js. Compares Node gateway to PingOne Agent Gateway.

### S27. Signed Agent Card interop verifier (Tester, S, value 3, overlap: D10 card validator)
Seeds: demo_api_server/scripts/verifyCardSigningInterop.mjs (real-jose interop for A2A v1.0 section 8.4), standalone/hostile-a2a-agent/agent-card.mjs, .claude/skills/a2a-protocol. Add as D10 seed.

### S28. Audit/event streaming to SIEM (Demo, S-M, value 3, overlap: C16 webhook viewer, F4 OTel)
Story: PingOne webhooks and audit events land in New Relic / Datadog / Kibana without code; show the config and the dashboard.
Seeds: docs/PINGONE-WEBHOOK.md (Option A direct to New Relic; Option B via the app), docs/observability/datadog-scaffold.md, docs/kibana-pingone-sso.md, scripts/run-kibana-pingone-proxy.sh, demo_api_server/routes/webhookPingOne.js (97 lines), webhookDavinci.js, docs/privilege-elasticsearch-kibana-runbook.md.
Needs: vendor accounts; PingOne webhook UI is manual.

### S29. SE cluster deploy tool for family demos (Tool, M, value 3, overlap: E2 shelf, base distribution)
Seeds: se-skills-export/ping-se-cluster-deploy/SKILL.md, .claude/skills/se-k8-deploy, scripts/install-se-kubeconfig.sh, scripts/ping-email.sh (valid-Ping-email rule), scripts/se-gateways.sh, scripts/deploy-live.sh, standalone/*/k8s. Internal SE only; needs shared cluster access.

### S30. Terraform local-stack lifecycle (Tool, S, value 2, overlap: none)
Seeds: terraform/README.md, terraform/deploy-se.sh, scripts/terraform-docker-contract.test.sh. Note: terraform/terraform.tfvars and tfstate exist in the working tree; do not copy (may contain secrets; not read). Wraps docker compose only, no Ping resources, so weak demo value.

### S31. Edition / standalone extractor (Tool, M, value 3, overlap: base distribution (hash-manifest sync))
Seeds: scripts/export-edition.js (+ test), docs/superpowers/specs/2026-10-03-edition-split-design.md, docs/editions/fresh-environment-gaps.md, scripts/check-root-allowlist.js, scripts/check-fresh-clone-hygiene.js. The plan mentions export-edition.js already (line 255); listed because it is the maker's tool for carving the family out.

### S32. Demo state export/import (Tool, S, value 2, overlap: base Reset 0.8)
Seeds: exportMigrationBundle.js, importMigrationBundle.js, uninstall.js (teardown phases with skip flags). Mostly base features.

### S33. Support-console delegation (Demo, M, value 3, overlap: C6, B9)
Story: a help-desk operator acts for a customer with real RFC 8693 delegation; actor = admin BFF client, subject via headless pi.flow sign-on.
Seeds: docs/superpowers/specs/2026-10-11-support-console-real-delegation-design.md (approved design; states mayAct is removed from the platform and act is minted from the actor token client_id), docs/superpowers/specs/2026-08-08-admin-support-console-design.md. Implementation status UNVERIFIED.

### S34. DaVinci flow kit with per-vertical branding (Skin/Demo, M, value 3, overlap: A10 DaVinci runner, A4 CIBA, A21)
Seeds: scripts/davinci-brand-ciba-flows.mjs, docs/Super_Banking_MCP_Tool_Authorization_DaVinci.json, docs/Super_Banking_Transaction_Authorization_DaVinci.json, .claude/skills/pingone-davinci-orchestration/SKILL.md, demo_api_server/services/davinciFlowClient.js, docs/DAVINCI_ORCHESTRATION_STATUS.md. Value is import-the-JSON-flows plus brand screens by a 2-char code.

### S35. Knowledge grounding on/off agent (Demo, M, value 3, overlap: E1 RAG Q&A partly, D8)
Story: same agent with grounding flag off (hallucinates) then on (cites sources), then show access control on the documents.
Seeds: docs/knowledge-grounding-demo-script.md, docs/knowledge-bundle-spec.md, demo_api_server/routes/knowledgeRoutes.js, documentRag.js. Verify authorization story is real (UNVERIFIED).

### S36. Ungoverned laptop agent (OpenCLI + sidecar) (Demo, S, value 3, overlap: D6, D16)
Seeds: docs/runbooks/ungoverned-agent-opencli.md, standalone/hostile-mcp-server. Overlap heavy; treat as D6/D16 seed.

### S37. PAT to OAuth migration checker (Tool, S, value 2, overlap: none)
Seeds: docs/pat-to-oauth-migration-guide.md (which "PAT" is unclear; read only its headings, UNVERIFIED relevance to PingOne), docs/oauth-client-credentials-guide.md. Weak; included for completeness.

### S38. Single-purpose conversions (Tool, S, value 2, overlap: E3 Diagram studio)
Seeds: scripts/lucid-vsdx-to-diagram.py, scripts/export-drawio.mjs, scripts/svg2png.js, scripts/render-diagrams.sh, docs/*.drawio. Seed material for E3.

## Skills that overlap catalog items (no new repo; add as seeds)
| Source | Catalog id |
|---|---|
| ~/.claude/skills/par/SKILL.md | C7 PAR tester (already seeded) |
| ~/.claude/skills/pingone-sample-apps/SKILL.md (devdocs sample apps: custom-admin-role, m2m-credentials, mfa-demo, user-registration in go/js/python/react/angular; the apps themselves live outside AI-DEMO2, location UNVERIFIED) | A11, A12, A1 |
| claudSkills/pingone/ciba, scripts/spike-ciba-login.mjs, docs/superpowers/specs/2026-10-17-ciba-login-spike-result.md | A4 |
| claudSkills/pingone/pingone-recognize | A8 |
| claudSkills/pingone/pingone-session-termination | A22 |
| claudSkills/pingone/oauth-pingone | C-group grants |
| se-skills-export/pingone-protect-ai-demo, demo_api_server/services/pingOneProtectService.js (53 lines) | A6, A7 |
| scripts/demo-readiness.js, scripts/useCaseSweep (demo_api_server/scripts/useCaseSweep.js), scripts/demo-launcher-server.mjs, docs/demo-launcher/index.html | E2, E7 |
| scripts/vault-hydrate / check-env / ENV_VALIDATION_SCHEMA.md | base doctor 0.7 |
| scripts/export-learning-hub.mjs, index-learning-hub-documents.mjs | E1 |
| spiffe/, scripts/validate-spiffe-profile.mjs, demo_api_server/services/spiffe*.js | F8-F10 |

## Recommended order of the new ones
1. S1 bootstrap, S2 cleaner, S3 scope matrix (all small tools every SE would use; same worker-app auth).
2. S10 PF in a box and S11 PF+MFA kit (PF-first customers).
3. S14 P1AZ generator/predictor (fills a real gap: no import API).
4. S9 Bedrock, S21 TraT, S23 red-team harness.
Skip or fold: S6, S12, S16, S17, S26, S30, S32, S37.
