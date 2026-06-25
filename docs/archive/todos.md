


Pending Todos:
Make agent response text bolder, bigger, and more prominent with dramatic background styling — ensure responses cannot be missed (ui, 0d ago)
Auto-scroll agent component to bottom on each response — bring response into immediate view without user scrolling (ui, 0d ago)
Read PDF - OAuth 2.0 Token Exchange info for PingOne implementation help (auth, 2d ago)
Surface sub claim as user ID and act/agent ID in token chain display and education panels (ui, 2d ago)
Audit PingOne apps for missing apps including Super Banking Admin App (auth, 2d ago)
Correct PingOne resource-scope mental model — resources are pre-created with audience, apps only pick scopes (auth, 2d ago)
Fix agent layout proportions, token chain and button gaps in middle and left modes (ui, 2d ago)
Reorganize PingOne apps — OIDC agents to AI Agents group, OIDC user apps to Applications group (auth, 2d ago)
Add draw.io flowchart diagrams for MFA, user consent, and agent request flow with RFC annotations (ui, 2d ago)
Add STEP_UP_ACR_VALUE prompt to setup wizard environment configuration (auth, 2d ago)
Make account names display friendly instead of raw IDs in agent responses (ui, 2d ago)
Require login for all bank account actions; block unauthenticated transfers (auth, 2d ago)
Revisit MFA approach — direct PingOne MFA APIs vs deviceAuthentications policy-based flow (auth, 2d ago)
Update education panels to explain PingOne deviceAuthentications MFA flow (ui, 2d ago)
Update MCP tools education panel to explain MFA gate on tool listing (ui, 2d ago)
Update Step by Step education panel with real aud may_act values and both exchange modes (ui, 2d ago)
Study AI-IAM-CORE Webinar Postman collection to fix 2-token exchange path (auth, 2d ago)
Add unauthenticated agent chip group with login prompt chip, keep existing chip groups (ui, 2d ago)
Fix floating agent popout window to match agent height and width (ui, 2d ago)
Middle agent layout needs scrollbar when window height is short (ui, 2d ago)
*Include PINGONE_MAY_ACT docs in Phase 5 user documentation (docs, 2d ago)
*Merge config and demo-data into one unified configuration page (ui, 2d ago)
*Token Endpoint Auth Method Selector on Demo Data Page (ui, 2d ago)*
Add Vercel env vars for 2-exchange delegation and fix warning message context (api, 2d ago)
Script PingOne resource server and scope setup via Management API (api, 2d ago)
Update AGENT_OAUTH credentials in .env for recreated MCP Token Exchanger (api, 2d ago)
Fix doc error - Super Banking User App Resources tab scope should be agent:invoke not banking:agent:invoke (docs, 2d ago)
Update docs to reflect Applications vs AI Agent category in PingOne console (docs, 2d ago)
Update token exchange docs and education pages with canonical names, descriptions, scopes, and flow diagrams (docs, 2d ago)
Add MFA setup guide to docs — PINGONE_MFA_POLICY_ID and device enrollment (docs, 2d ago)
Add Multi_Factor sign-on policy to Super Banking user app in PingOne setup instructions (docs, 2d ago)
Add RFC 8707 resource indicators to educational panels (docs, 0d ago)
Add self-service button to side menu (ui, 0d ago)
Fix Vercel Env tab requires VERCEL_TOKEN and VERCEL_PROJECT_ID (ui, 2d ago)
Make config page tabs more visually obvious (ui, 2d ago)
Support all 4 PingOne token auth methods for management worker including JWT generation (api, 2d ago)
Worker App config tab credentials lost on browser refresh (api, 2d ago)- [ ] MCP Gateway Config UI: BFF `GET /api/gateway/config` + UI page with live config display and downloadable PingGateway `mcp.json` route export (generated from env vars). Add as follow-on to phase 243.
- [ ] Get rid of all these icons, just text.
- [x] New window button opens middle browser but it has side menu and it is not pop out.
- [ ] Test all action buttons, transfer does not hit consent or mfa with $1000.00 transferred from checking to savings. Thresholds are unknown / might be incorrect.
- [x] Checkbox text is unreadable; make the text white.
- [x] "view sensitive account details" chip does not update 12 step. Make sure all chips and commands update the 12 step even if it goes to LLM.
- [x] Why is banking_mcp_server not connected? "Sequential reasoning complete for: 'Should I transfer money from checking to savings?'. Connect the MCP server (banking_mcp_server) for full AI-powered analysis."
- [ ] Dashboard toolbar missing dollar-sign icon that opens small panel for changing step-up thresholds on the fly.
- [x] The "always float" checkbox does not show float icon in bottom right to open floating agent.
