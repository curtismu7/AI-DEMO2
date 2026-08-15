1. ~~Fix Privilege MCP guide (update) - [https://ai-demo.ping-devops.com/privilege-mcp-learning](https://ai-demo.ping-devops.com/privilege-mcp-learning)~~   
2. Test - [https://ai-demo.ping-devops.com/protocol-playground](https://ai-demo.ping-devops.com/protocol-playground)  
3. [https://ai-demo.ping-devops.com/themes](https://ai-demo.ping-devops.com/themes) - should not be admin login  
4. Update to current code - [https://ai-demo.ping-devops.com/langchain](https://ai-demo.ping-devops.com/langchain)  
~~5. What does this do: [https://ai-demo.ping-devops.com/agent-flow-inspector](https://ai-demo.ping-devops.com/agent-flow-inspector) — full-page docked view of the Agent & Token Flow Inspector (same UnifiedTokenFlowInspector panel as the floating overlay). Real-time agent execution + OAuth token lifecycle. KEEP.~~  
~~6. Make sure current - [https://ai-demo.ping-devops.com/langchain](https://ai-demo.ping-devops.com/langchain)~~  
7. Make sure [https://ai-demo.ping-devops.com/pingone-mcp-inspector](https://ai-demo.ping-devops.com/pingone-mcp-inspector) the custom server works  
8. Chain tab on [https://ai-demo.ping-devops.com/agent-gateway-inspector](https://ai-demo.ping-devops.com/agent-gateway-inspector) - says “run chain” no such button  
9. Needs spinner when executing tools  
10. This page needs work - [https://ai-demo.ping-devops.com/agent-gateway-inspector?subtab=capabilities](https://ai-demo.ping-devops.com/agent-gateway-inspector?subtab=capabilities) duplicate other pages  
11. Add "Try it out" / execute API calls to [https://ai-demo.ping-devops.com/oas-demo](https://ai-demo.ping-devops.com/oas-demo) — currently read-only OAS 3.1 spec viewer, needs request execution  
~~12. Do we need this: [https://ai-demo.ping-devops.com/privilege-demo](https://ai-demo.ping-devops.com/privilege-demo) — SE presenter hub (Setup + Script tabs, persona cards, console links). KEEP.~~  
13. [https://local.ping-devops.com:4000/sdk-login](https://local.ping-devops.com:4000/sdk-login) - CONFIG FIX: set `PINGONE_SDK_DEMO_CLIENT_ID` in /settings + register `{origin}/sdk-login/callback` as redirect URI in PingOne PKCE SPA app. Page code already shows instructions when unconfigured.  
~~14. [https://ai-demo.ping-devops.com/transaction-consent](https://ai-demo.ping-devops.com/transaction-consent) — consent-only simulation by design. No OTP needed. KEEP as-is.~~  
~~15. [https://ai-demo.ping-devops.com/pingone-authorize](https://ai-demo.ping-devops.com/pingone-authorize) — CONFIG FIX: set `PINGONE_WORKER_CLIENT_ID` + `PINGONE_WORKER_CLIENT_SECRET` in `.env` or App Configuration → PingOne Setup. Also: no decision endpoints found — verify P1AZ decision endpoints exist in environment. DONE~~  
16. Make sure this is still right - compare against SOT [https://ai-demo.ping-devops.com/scope-audit](https://ai-demo.ping-devops.com/scope-audit) — page loads, admin gate works correctly. Needs manual admin sign-in to verify scope data vs SOT.  
17. Weather MCP login prompt — suspect: (a) `ff_weather_mcp_showcase` flag off, (b) inspector call has no `act` claim → policy_violation returns `login_required:true`. Test: call weather via banking agent chat (has act) vs direct inspector call (no act) to isolate. Check flag state first.  
18. [https://ai-demo.ping-devops.com/admin/pingone](https://ai-demo.ping-devops.com/admin/pingone) — nav label says "PingOne Admin" but renders generic `Dashboard` component (backward-compat alias from PR #1486). DECISION NEEDED: rename nav label to match content, or build real PingOne admin page here. AdminSideNav.jsx line 747-748.    
~~19. Industry verticals, do we need them, are they doing anything? — YES, 10 active routes (banking/healthcare/retail/etc) + master editor. Core multi-tenant demo structure. KEEP~~  
20. Missing CSS on buttons - [https://ai-demo.ping-devops.com/admin/verticals](https://ai-demo.ping-devops.com/admin/verticals) — Monaco JSON editor for all 10 vertical brand configs (themes/personas/flags). Feature-complete. Fix CSS on buttons.  
~~21. AI Attack demos, do we need these? — YES. Live security education: 8 attack types (prompt injection, scope abuse, HITL bypass, etc.) run against real agent. Core demo value. KEEP~~  
22. [https://ai-demo.ping-devops.com/audit](https://ai-demo.ping-devops.com/audit) - no activity — investigate why  
23. Wire LearningHub actions — `/learning` hub exists but action handlers are stubs (lines 32/38/44 in LearningHub.tsx). LearningLogLearnPane (activity viewer) already works. TODO: wire navigation/actions in LearningHub.   
24. [https://ai-demo.ping-devops.com/monitoring/activity-log](https://ai-demo.ping-devops.com/monitoring/activity-log) - no side nav bar  
25. [https://ai-demo.ping-devops.com/monitoring/pingone-events](https://ai-demo.ping-devops.com/monitoring/pingone-events) - No events  
~~26. Pingone authorize - [https://ai-demo.ping-devops.com/monitoring/p1az](https://ai-demo.ping-devops.com/monitoring/p1az) — P1AZ authorization monitoring dashboard (gate-skip, policy-not-found, fail-open events; 30s polling). KEEP~~  
27. [https://ai-demo.ping-devops.com/tracing](https://ai-demo.ping-devops.com/tracing) - Jaeger unavailable   
28. [https://ai-demo.ping-devops.com/transaction-trace](https://ai-demo.ping-devops.com/transaction-trace) - everything is 2 hops.    
~~29. Dupe - [https://ai-demo.ping-devops.com/check?](https://ai-demo.ping-devops.com/check?)~~  
30. [https://ai-demo.ping-devops.com/architecture/overview](https://ai-demo.ping-devops.com/architecture/overview) - does not seem right, make sure current  
31. Worth keeping, [https://ai-demo.ping-devops.com/architecture/phase-266](https://ai-demo.ping-devops.com/architecture/phase-266) does it work?  
32. Agent onboarding 3 flows, need looking at  
33. Make sure current - [https://ai-demo.ping-devops.com/privilege-mcp-diagrams](https://ai-demo.ping-devops.com/privilege-mcp-diagrams)  
34. Not really comparing agent to P1AZ? [https://ai-demo.ping-devops.com/gateway-enforcement-map](https://ai-demo.ping-devops.com/gateway-enforcement-map) - oh this is new one, that came from article. Code graph not reachable; should load api-server code by default  
35. Agent studio: CUT `/agent-studio-preview` (stale stakeholder demo artifact). KEEP `/personal-agent` (functional multi-skin chat UI, 3-gate security flow) + `/personal-agent/client` (pop-out variant). Remove agent-studio-preview route.  
~~36. Do we need this: [https://ai-demo.ping-devops.com/graphify](https://ai-demo.ping-devops.com/graphify) — educational showcase for code graph querying (canned offline demos, no live CLI). KEEP~~  
37. [https://ai-demo.ping-devops.com/mgmt-api](https://ai-demo.ping-devops.com/mgmt-api) — admin inspector for read/create/cleanup ops. KEEP, but needs review pass to confirm it's useful and not exposing unnecessary ops.  
~~38. What does this do? [https://ai-demo.ping-devops.com/resource-server](https://ai-demo.ping-devops.com/resource-server) — OAuth/RFC 8693 token inspector: JWT claims, scope badges, audience matching. KEEP~~  
~~41. Agent UI group not needed~~  
~~42. Vertical group not needed~~  
