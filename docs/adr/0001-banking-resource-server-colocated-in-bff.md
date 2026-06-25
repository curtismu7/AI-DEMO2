# banking_resource_server is co-located in the BFF, not a separate service

Phase 266 introduced three credential dispositions in the MCP gateway (`api_key`, `dual_token`, `bankingdata`). The `bankingdata` path needed an OAuth-protected backend that the gateway could call with a re-exchanged token at a distinct audience (`banking-resource-server.ping.demo`). We chose to expose those endpoints (`/api/resource-server/*`, `/api/resource-server-cc/*`) inside the existing `banking_api_server` Express process rather than spinning up a separate Node service — same code, same deploy, but a different `aud` claim enforced per-route. This keeps Phase 266 demo runnable from a single `run-demo.sh` and avoids duplicating the banking data store across processes.

**Status:** accepted

**Trade-off:** A future reader sees `BANKING_RESOURCE_SERVER_BASE_URL` defaulting to `http://localhost:3001` and naturally assumes a sibling codebase exists. There is no `banking_resource_server/` directory. The cost of splitting it out later (extracting the routes, sharing the data store, second deploy target) is meaningful — this decision is hard to reverse. The benefit was demo simplicity: one fewer process, one less port, no cross-process data-store coordination, and the audience separation that Phase 266 actually needed is enforced at the route level inside the BFF.

**Where this lives now:** `banking_api_server/routes/resourceServer.js` + `routes/resourceServerCC.js`. Gateway-side caller logic: `banking_mcp_gateway/src/router.ts` (bankingdata disposition).
