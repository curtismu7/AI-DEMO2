# Survey: other repos under /Users/cmuir/Development

Read-only survey, 2026-10-20. Sources are READMEs, package.json, directory listings, a few file heads. No code run, no .env read. Sizes via du -sk.

## A. Directory verdicts

| Dir | What it is | Verdict |
|---|---|---|
| NotFlux-MCP-main (21 MB, no git) | "Zero-Trust AI Agent Governance" blueprint: 3-hop RFC 8693 token chain (person -> agent -> mcp -> kong token, `act.sub` agent id, per-hop `aud`), gateway-enforced stateless HITL (401 WWW-Authenticate + transaction_id), "zero-knowledge" MCP server. Parts: `src/index.ts` (MCP server, TS, Streamable HTTP), `notflux-app/{frontend,backend}`, `notflux-agent/{agent.py,deploy.py}` (Vertex ADK), `k8s/`, `ping-gateway-2026.3.0/instance`, `docs/HITL.md`. | Repackage (two slim demos). Full stack needs Vertex AI + Kong + AIC (heavy), so not as-is. |
| content-api-aam-demo (1.3 MB) | PingOne Authorize API Access Management side-band: demo page -> PingGateway -> P1 Authorize decision -> content API. Policy in `policy/restrictions.yaml` (age x region). Has jest tests, k8s manifests, `docs/PINGONE_CONSOLE_SETUP_STATUS.md` (console steps half done). | Repackage. Small, has tests, one clear story. Needs live P1 Authorize AAM gateway credential; the decision is not mock-able except by a stub of the same YAML rules. |
| mcp-resource-server (1.1 MB) | Config-driven banking MCP server; `VERTICAL=healthcare` switches tools/data/scopes; SQLite bundled; Dockerfile, compose, helm, jest. `verticals/{banking,healthcare}/{vertical.json,schema.sql,seed.json}`. | Candidate nearly as is (the base's vertical mechanism, E5, could reuse this format). |
| mattermost-hitl | Only `docker-compose.yml` (Mattermost EE 9.11 + postgres) and `k8s/mattermost.yaml`. | Ignore as a demo. Memory says the Slack/Mattermost approval track is closed/exhausted (privilege-hitl-track2-probe). Keep only as an optional approver-channel container. |
| oauthplayground (MasterFlow API v9.13.4, big: src 20 MB, node_modules present) | Huge React/Vite PingOne OAuth/OIDC/MFA playground: `src/flows2/flows/*` (auth code, device, DPoP, PAR, token exchange, introspection, revocation, SAML bearer, redirectless, hybrid, CIBA...), `src/v8/flows` (MFA, Protect), `src/pages/protect-portal` (brand themes), 6 local MCP servers, `company-portal-mocks`, etc. | Mine for seeds, do not repackage whole. Several single pages are good standalone seeds (see candidates). |
| oauthplayground/mcp-servers + oauth-simulator / jwt-verifier / oauth-oidc / security-compliance / pingone MCP servers | Small TS MCP servers (jwt_decode_full, jwt_verify_signature, jwt_fetch_jwks, oauth flow simulator with 6 tools). TOOL_INVENTORY.md says some are "planned" (UNVERIFIED which are finished). | Candidate Tool (repackage). |
| oauthplayground/company-portal-mocks, company-portal-login-mocks (36 KB each) | Config-driven mock company portals/login pages from `shared/companies.json` (palette, logoSvg, loginMode page/modal) plus `generate.py`. | Skin candidate, as is. |
| oauthplayground/se-ai-demo-banking-digital-assistant-main | Earlier copy of the banking demo (api, ui, mcp, langchain, lending service). | Ignore: ancestor of AI-DEMO2, already covered. |
| pingone-mcp-server (2.6 MB) | Upstream clone of github.com/curtismu7/pingone-mcp-server (Go; fork of pingidentity's). | Ignore as a demo (vendor). Possible seed for C17 only. |
| pingone-authenticator-sample-app-ios | Ping's iOS authenticator sample (Swift 5.5, QR pairing, push, OTP). | Ignore as a repo (needs Xcode, device). Referenced as a companion for MFA/CIBA testers. |
| pingone-sample-apps-skill | Public Claude skill for devdocs sample apps (4 use cases x 5 stacks). Origin curtismu7. | Skill, not a demo. The sample source itself (`devdocs-sample-apps-main`) is NOT on this machine (ls devdocs* empty) so a runner demo is UNVERIFIED. |
| SAMPLE-APPS-HANDOFF.md | 2026-08-27 handoff: review of ping-rocks/devdocs-sample-apps, surfacing samples in AI-DEMO2 nav. | Doc. Context for the sample-apps runner candidate. |
| se-skill-catalog (+ se-skill-catalog-source.html) | Claude skills for SEs: bedrock-agentcore-pingone (M2M + USER_FEDERATION, verified 2026-08-12 vs SDK 1.21.0), p1az-import-generator, pingone-authorize-ea-api-build, oauth-pingone, pingone-api-calls, ping-se-cluster-deploy. | Skills; two give real demo seeds (Bedrock AgentCore, P1AZ import generator). |
| CDN (assets, no git readme) | Brand logos (United, FedEx, AmTrust, Southwest...), DaVinci exports: AmTrust adaptive-auth-with-Protect+MFA flow JSONs (~470 KB each), "PingOne_MFA Authentication subflow" (1.5 MB), six `*-mf-configObject.json` variants (passwordlessOnly, Usernameless, StandardAdaptive, VerifyOnHigh, VerifyRegistration, credentials), `masterflowUtils.js`, landing pages, claude-skills bundle. | Seed library. DaVinci flow pack is a real candidate; logos feed Skin/E6. |
| Privilege-standalone/{ai-gateway-client,mcp-inspector,llm-gateway} | Three standalone tools. First two are in catalog D20/D3. llm-gateway = 2-tier local LLM router (router.js, promptRedact.js, residencyPolicy.js = RAM residency, not data residency). | Already cataloged (D19/D20/D3). Note: promptRedact.js is a small separable seed. |
| privilege-demo (52 KB src) | Cedar decision module (`engine.js`, `decide.js`, `mapClaims.js`, `validatePolicies.js`, 6 .cedar policies). | Already cataloged B5/D1 ("built and hardened"). |
| id-jag-standalone | The existing kit (playground, resource-as, mcp-sample, pingfederate, web). | Already covered (C1). |
| AI-DEMO2-pfa2a | Worktree of AI-DEMO2 (150 entries). | Ignore: same repo. |
| edition-exports/{P1-AI-DEMO,PF-AI-DEMO,followups-P1} | Exported editions of AI-DEMO2 (full copies, session reports). | Ignore for demos; evidence of the P1/PF edition split the base must support. |
| ai-demo2-demo-steps-run | Playwright drivers + results for UC38 demo steps (`drive-demo-steps.js`, `drive-approvals.js`, `shots/`). | Ignore (test artifact); idea for story-runner only. |
| ping-se-scripts | `install.sh`, `install-se.sh`, `AI-demo/` (a full AI-DEMO2 clone). | Ignore: installer of AI-DEMO2, not a new demo. |
| cliche, fortress-code, fortress-code-mac, graphify, models, private, .ai-demo2-backups | Mac menu-bar clipboard/capture app; US-only-governed VS Code/Mac AI chat; graph tool; model files; tmp; env/vault backups. | Ignore: not Ping demos. (.ai-demo2-backups holds secrets, not opened.) |
| autodesk-platform (2).pdf, SE1-PingOne Privilege AI (MCP) Gateway ... .pdf | PDFs, not opened. | Not covered. |

## B. Candidates (see structured list for the same data)

1. **Three-hop token chain with audience isolation** (Demo). Seeds: NotFlux-MCP-main/src/index.ts, README.md section 1 and 3. Overlap C6 (OBO) but distinct: chain of three exchanges with per-hop `aud` and per-tool scope, replay-the-wrong-token negative tests. Mock-able. M, value 4.
2. **Gateway-driven stateless HITL (401 WWW-Authenticate step-up)** (Demo). Seeds: NotFlux-MCP-main/docs/HITL.md, src/index.ts, notflux-app/frontend. Overlap D15 (D15 is hold/approve/retry in AI-DEMO2; this one is the challenge format with transaction_id and OTP/QR widget). Needs P1 Authorize for real. M, value 4.
3. **API Access Management side-band (PingGateway + P1 Authorize)** (Demo). Seeds: content-api-aam-demo/. Overlap B1 partly, A19. S-M, value 4. Needs live AAM gateway credential; console steps half done.
4. **Vertical-in-a-box MCP server** (Demo/Tool). Seeds: mcp-resource-server/verticals, vertical.json format. Overlap E5, D26, D2. S, value 3.
5. **Response-modes explainer** (Tester). Seeds: oauthplayground/src/pages/learn/ResponseModesLearnPage.tsx, src/flows2/flows/redirectless.flow.tsx. Overlap A11 loosely; none exact. S, value 3.
6. **Webhook / audit-activity viewer** (Tester). Seeds: oauthplayground/src/pages/PingOneWebhookViewer.tsx (2331 lines), PingOneAuditActivities.tsx. Overlap C16 (same item; list as seed not new). Included because catalog marks C16 as unbuilt: this is its seed.
7. **PAR vs RAR comparator** (Tester). Seed: src/pages/PARvsRAR.tsx. Overlap C7/C8 (seed).
8. **CIBA vs device authorization explainer** (Tester). Seed: src/pages/CIBAvsDeviceAuthz.tsx. Overlap A4/C11 (seed).
9. **JWKS troubleshooting** (Tester). Seed: src/pages/JWKSTroubleshooting.tsx. Overlap C5 (seed).
10. **SAML bearer / JWT bearer grant tester** (Tester). Seeds: src/flows2/flows/samlBearerAssertion.flow.tsx, src/pages/flows/JWTBearerFlow.tsx. Overlap C1 (ID-JAG uses JWT bearer) and C13 partly. UNVERIFIED depth. S.
11. **Branded sign-in portal skins (airline/bank/shipping)** (Skin). Seeds: src/pages/protect-portal/themes/*.theme.ts (american-airlines, bank-of-america, delta, fedex, pingidentity, southwest-airlines, united-airlines), CDN logos. Overlap A21, E6. S.
12. **Company portal mock generator** (Skin/Tool). Seed: company-portal-mocks/shared/companies.json + generate.py. Overlap A21/E6. S.
13. **Risk-aware login portal (Protect evaluation display)** (Demo). Seeds: protect-portal/components/RiskEvaluationDisplay.tsx, MFAAuthenticationFlow.tsx, v8/flows/PingOneProtectFlowV8.tsx. Overlap A6. Include only if A6 is not built from AI-DEMO2.
14. **Password reset / account recovery storyline (HelioMart)** (Demo). Seed: src/pages/security/HelioMartPasswordReset.tsx (4800 lines). Overlap A12. M.
15. **Retail MFA scenario (Kroger-style grocery)** (Demo). Seed: src/pages/flows/KrogerGroceryStoreMFA.tsx. Overlap A1/A3. Store-themed story for the MFA tester. S.
16. **OAuth/JWT toolbelt as MCP tools** (Tool). Seeds: oauthplayground/jwt-verifier-mcp-server, oauth-simulator-mcp-server, oauth-oidc-mcp-server. Overlap C3, D5. S-M. Completeness UNVERIFIED.
17. **DaVinci adaptive-MFA flow pack** (Demo). Seeds: CDN/*-mf-configObject.json (6 variants), CDN/AmTrust_-...json, CDN/PingOne_MFA Authentication subflow_Export_*.json. Overlap A10, A6, A3. M. Needs live DaVinci import.
18. **Bedrock AgentCore + PingOne** (Demo). Seed: se-skill-catalog/skills/bedrock-agentcore-pingone (SKILL.md + references). New: AWS-hosted agent with M2M and user-federation (3LO). Overlap none (D-group has no AWS agent runtime). Needs AWS account + PingOne. M-L, value 4. Skill says verified 2026-08-12.
19. **P1 Authorize snapshot import generator** (Tool). Seed: se-skill-catalog/skills/p1az-import-generator. Overlap B2. S.
20. **Prompt redaction filter** (Demo/Tool). Seed: Privilege-standalone/llm-gateway/promptRedact.js (+ test). Overlap D12 (AI Guard) loosely. S.
21. **Mock-MCP agent flow explainer** (Demo). Seed: src/pages/flows/MockMcpAgentFlowPage.tsx. Overlap D2. S, low.
22. **PingOne sample apps runner** (Demo). Seeds: pingone-sample-apps-skill/, SAMPLE-APPS-HANDOFF.md. Source samples missing locally, UNVERIFIED. Overlap A12, A11. M.

## C. Not covered
- PDFs and image files at top level (not opened).
- Contents of node_modules, dist, .env, secrets/backups.
- No code was executed; "works" claims are from READMEs only.
- oauthplayground pages beyond names (hundreds of files); only a dozen sizes checked.
- Planned vs finished status of the oauthplayground MCP servers (from TOOL_INVENTORY.md dated June 2026).
