# Fix Privilege MCP guide (update) — ai-demo.ping-devops.com

Status split from raw punch list. Strikethrough items in source = done. Original numbering kept for traceability.

## Fixed (14)

1. Fix Privilege MCP guide (update) - [privilege-mcp-learning](https://ai-demo.ping-devops.com/privilege-mcp-learning)
5. [agent-flow-inspector](https://ai-demo.ping-devops.com/agent-flow-inspector) — full-page docked view, history list added to right side.
6. Make sure current - [langchain](https://ai-demo.ping-devops.com/langchain)
12. [privilege-demo](https://ai-demo.ping-devops.com/privilege-demo) — SE presenter hub. KEEP, no change needed.
14. [transaction-consent](https://ai-demo.ping-devops.com/transaction-consent) — consent-only simulation by design. KEEP as-is.
15. [pingone-authorize](https://ai-demo.ping-devops.com/pingone-authorize) — `PINGONE_WORKER_CLIENT_ID`/`SECRET` set, P1AZ decision endpoints verified.
19. Industry verticals — 10 active routes + master editor confirmed load-bearing. KEEP.
21. AI Attack demos — 8 attack types confirmed load-bearing, live against real agent. KEEP.
26. [monitoring/p1az](https://ai-demo.ping-devops.com/monitoring/p1az) — P1AZ authorization monitoring dashboard confirmed working. KEEP.
29. Dupe route - [check?](https://ai-demo.ping-devops.com/check?) removed.
36. [graphify](https://ai-demo.ping-devops.com/graphify) — educational showcase confirmed intentional (canned offline demos). KEEP.
38. [resource-server](https://ai-demo.ping-devops.com/resource-server) — OAuth/RFC 8693 token inspector confirmed working. KEEP.
39. Agent UI nav group — confirmed not needed, removed.
40. Vertical nav group — confirmed not needed, removed.

## Remaining (26)

2. Test - [protocol-playground](https://ai-demo.ping-devops.com/protocol-playground)
3. [themes](https://ai-demo.ping-devops.com/themes) - should not require admin login
4. Update to current code - [langchain](https://ai-demo.ping-devops.com/langchain)
7. Confirm [pingone-mcp-inspector](https://ai-demo.ping-devops.com/pingone-mcp-inspector) custom server works
8. Chain tab on [agent-gateway-inspector](https://ai-demo.ping-devops.com/agent-gateway-inspector) - "run chain" button missing
9. Needs spinner when executing tools
10. [agent-gateway-inspector?subtab=capabilities](https://ai-demo.ping-devops.com/agent-gateway-inspector?subtab=capabilities) — duplicates other pages, needs work
11. Add "Try it out" / execute API calls to [oas-demo](https://ai-demo.ping-devops.com/oas-demo) — currently read-only OAS 3.1 viewer
13. [sdk-login](https://local.ping-devops.com:4000/sdk-login) — CONFIG FIX: set `PINGONE_SDK_DEMO_CLIENT_ID` in /settings + register `{origin}/sdk-login/callback` redirect URI in PingOne PKCE SPA app. Page already shows instructions when unconfigured.
16. [scope-audit](https://ai-demo.ping-devops.com/scope-audit) — page loads, admin gate works. Needs manual admin sign-in to verify scope data vs source of truth.
17. Weather MCP login prompt — suspect (a) `ff_weather_mcp_showcase` flag off, or (b) inspector call missing `act` claim → policy_violation `login_required:true`. Test: weather via banking agent chat (has act) vs direct inspector call (no act). Check flag state first.
18. [admin/pingone](https://ai-demo.ping-devops.com/admin/pingone) — nav label says "PingOne Admin" but renders generic `Dashboard` component (backward-compat alias from PR #1486). DECISION NEEDED: rename nav label, or build real PingOne admin page. See `AdminSideNav.jsx` line 747-748.
20. Missing CSS on buttons - [admin/verticals](https://ai-demo.ping-devops.com/admin/verticals) — Monaco JSON editor for 10 vertical configs, feature-complete, button CSS broken.
22. [audit](https://ai-demo.ping-devops.com/audit) - no activity, investigate why
23. Wire LearningHub actions — `/learning` hub exists but action handlers are stubs (`LearningHub.tsx` lines 32/38/44). `LearningLogLearnPane` (activity viewer) already works.
24. [monitoring/activity-log](https://ai-demo.ping-devops.com/monitoring/activity-log) - no side nav bar
25. [monitoring/pingone-events](https://ai-demo.ping-devops.com/monitoring/pingone-events) - no events
27. [tracing](https://ai-demo.ping-devops.com/tracing) - Jaeger unavailable
28. [transaction-trace](https://ai-demo.ping-devops.com/transaction-trace) - everything shows 2 hops
30. [architecture/overview](https://ai-demo.ping-devops.com/architecture/overview) - doesn't look right, confirm current
31. [architecture/phase-266](https://ai-demo.ping-devops.com/architecture/phase-266) — worth keeping, does it work?
32. Agent onboarding — 3 flows need review
33. Make sure current - [privilege-mcp-diagrams](https://ai-demo.ping-devops.com/privilege-mcp-diagrams)
34. [gateway-enforcement-map](https://ai-demo.ping-devops.com/gateway-enforcement-map) — not really comparing agent to P1AZ? New page from article. Code graph not reachable, should load api-server code by default.
35. Agent studio: CUT `/agent-studio-preview` (stale stakeholder demo artifact). KEEP `/personal-agent` (functional multi-skin chat UI, 3-gate security flow) + `/personal-agent/client` (pop-out variant). Remove agent-studio-preview route.
37. [mgmt-api](https://ai-demo.ping-devops.com/mgmt-api) — admin inspector for read/create/cleanup ops. KEEP, needs review pass to confirm useful and not exposing unnecessary ops.
