# Protocol Playground — Design Spec

**Date:** 2026-07-28  
**Author:** Claude Code  
**Status:** Approved

## Overview

Build an interactive protocol playground in `demo_api_ui` that visualizes and executes OAuth/OIDC flows (RFC 8693 token exchange, PAR, DPoP, CIBA/HITL, and future protocols). The playground renders sequence diagrams matching the BX Developer Protocol Playground reference design, allows step-by-step execution against live BFF endpoints, and inspects real tokens in transit.

**Why:** Protocol flows are complex; a visual, executable reference removes friction for developers, demos, and security audits. Auto-generating specs from code keeps diagrams in sync with implementation.

## Requirements

- Render 4 protocol flows (RFC 8693, PAR, DPoP, CIBA/HITL) in MVP phase
- Scale to all 9+ OAuth/OIDC protocols implemented across the banking demo
- Execute flows interactively: step-by-step, capture requests/responses, decode tokens
- Inspect live JWTs: scopes, audiences, expiry, signature validation
- Specs auto-generated from route annotations (no hand-authored JSON)
- Pixel-perfect sequence diagrams matching BX reference design
- Isolated new route (`/protocol-playground`) in demo_api_ui

## Architecture

### High-Level Data Flow

```
BFF Routes (@flow annotations)
         ↓
Route Introspector (npm run protocols:gen)
         ↓
protocolFlows.json (checked into git)
         ↓
ProtocolPlayground UI
         ├── Sidebar (protocol list)
         ├── SequenceDiagram (SVG rendering)
         ├── ActivityPanel (req/resp, tokens)
         └── ExecutionEngine (runs steps, calls BFF)
```

### Directory Structure

```
demo_api_ui/src/
├── components/
│   └── ProtocolPlayground/
│       ├── ProtocolPlayground.jsx        (main container)
│       ├── ProtocolSidebar.jsx           (left nav: protocol list)
│       ├── ProtocolViewer.jsx            (main content area)
│       ├── SequenceDiagram.jsx           (SVG canvas rendering)
│       ├── ActivityPanel.jsx             (right panel: req/resp/tokens)
│       ├── TokenInspector.jsx            (JWT decoder UI)
│       └── ExecutionControls.jsx         (Execute, Step, Reset buttons)
├── data/
│   └── protocolFlows.json                (generated; see introspector)
├── services/
│   ├── executionEngine.js                (steps through flows, calls BFF)
│   ├── diagramRenderer.js                (SVG sequence diagram layout)
│   └── tokenInspector.js                 (JWT decode, scope visualization)
└── routes/
    └── ProtocolPlaygroundRoutes.js       (route definitions)

demo_api_server/
├── scripts/
│   └── generateProtocolFlows.js          (introspector CLI)
├── routes/
│   └── ... existing routes with @flow annotations
```

## Component Specs

### ProtocolPlayground.jsx (Container)

State:
- `selectedProtocol` (string, protocol ID)
- `executionState` (object: current step, results, errors)
- `flowSpec` (current protocol's spec from protocolFlows.json)

Behavior:
- Loads `protocolFlows.json` on mount
- Renders sidebar + viewer
- Passes `selectedProtocol` → `ProtocolViewer`
- Passes execution state → `ActivityPanel`

### ProtocolSidebar.jsx

Render list of protocols from `protocolFlows.json`:
- RFC 8693 Token Exchange
- PAR (Pushed Authorization Request)
- DPoP (Demonstration of Proof-of-Possession)
- CIBA/HITL (Consent/HITL flows)

Click → emit `onSelectProtocol(id)` → parent updates state.

### SequenceDiagram.jsx

**Input:** Flow spec (actors, steps, branches)

**Rendering:**
- SVG canvas (custom, not Mermaid)
- Horizontal swim lanes: one per actor (Client App, Authorization Server, Token Exchanger, Resource Server, etc.)
- Vertical arrows for message flow
- Rectangles for decisions/branches (error paths highlighted)
- Labels: step number, HTTP method + endpoint, response status

**Interactivity:**
- Highlight current step (during execution)
- Dim completed steps
- On error, show red highlight + error message overlay

### ActivityPanel.jsx

Right-side panel showing live execution output:

**Sections:**
1. **Request** (JSON) — last HTTP request sent (method, endpoint, headers, body)
2. **Response** (JSON) — HTTP response status + body
3. **Token Inspector** (if response contains JWT) — decoded header/payload/signature, scopes, audiences, expiry

Updates in real-time as execution progresses.

### ExecutionEngine.js (Service)

Core logic:

```javascript
class ExecutionEngine {
  constructor(flowSpec, bffBaseUrl) { ... }
  
  async executeStep(stepId) {
    // 1. Get step definition from flowSpec
    // 2. Build HTTP request (method, endpoint, headers, body)
    // 3. Call BFF endpoint
    // 4. Capture response
    // 5. Return { success, request, response, decodedToken }
  }
  
  async executeAll() {
    // Run all steps sequentially
  }
  
  reset() {
    // Clear execution state, reset to step 1
  }
}
```

Calls BFF endpoints directly (e.g., POST /oauth/token, POST /introspect).

### TokenInspector.js (Service)

Utility functions:

```javascript
function decodeJWT(token) {
  // Returns { header, payload, signature, isValid }
}

function extractScopes(payload) {
  // Returns array of scopes from token
}

function highlightClaim(payload, claimName) {
  // Returns styled display (for UI)
}
```

## Route Annotation Format

Routes in `demo_api_server/routes/*.js` are annotated with JSDoc `@flow` tags:

```javascript
/**
 * Exchange ID token for access token (RFC 8693)
 * 
 * @flow rfc8693-token-exchange
 * @actor token-exchanger
 * @step 2
 * @expects { status: 200, body: { access_token, token_type, expires_in } }
 * @branch error status: 400 { error: 'invalid_grant' }
 */
router.post('/oauth/token', (req, res) => {
  // implementation
});
```

**Tag meanings:**
- `@flow <id>` — protocol ID this route belongs to
- `@actor <name>` — which actor in the sequence (Client App, Token Exchanger, etc.)
- `@step <number>` — order in the sequence
- `@expects` — expected HTTP status + response shape (for validation during execution)
- `@branch error` — error path in the flow (optional; multiple allowed)

## Introspector (npm run protocols:gen)

**Script:** `demo_api_server/scripts/generateProtocolFlows.js`

**Process:**
1. Scan all files in `demo_api_server/routes/*.js`
2. Parse JSDoc comments for `@flow` tags
3. Build a map: `flowId` → `{ name, actors, steps, branches }`
4. Output: `demo_api_ui/src/data/protocolFlows.json`
5. Check into git (treated as build artifact, like generated types)

**Example output** (`protocolFlows.json`):

```json
{
  "rfc8693-token-exchange": {
    "id": "rfc8693-token-exchange",
    "name": "RFC 8693 Token Exchange",
    "description": "Client exchanges ID token for access token via a delegated flow.",
    "actors": ["Client App", "Authorization Server", "Token Exchanger", "Resource Server"],
    "steps": [
      {
        "id": "step-1",
        "actor": "Client App",
        "action": "POST /oauth/token",
        "method": "POST",
        "endpoint": "/oauth/token",
        "payload": {
          "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
          "subject_token_type": "urn:ietf:params:oauth:token-type:id_token",
          "subject_token": "<id_token>"
        },
        "expected": { "status": 200, "body": { "access_token": "...", "token_type": "Bearer" } }
      },
      {
        "id": "step-2",
        "actor": "Token Exchanger",
        "action": "Validate token signature",
        "description": "Server verifies JWT signature against JWKS endpoint"
      }
    ],
    "branches": [
      {
        "condition": "Invalid signature",
        "status": 400,
        "response": { "error": "invalid_grant" }
      }
    ]
  },
  "par": { ... },
  "dpop": { ... },
  "ciba-hitl": { ... }
}
```

## MVP Scope (Phase 1)

**In scope:**
- 4 protocols fully annotated (RFC 8693, PAR, DPoP, CIBA/HITL)
- Introspector CLI working, generates spec
- ProtocolPlayground UI (all components above)
- SequenceDiagram (SVG rendering with current-step highlighting)
- ActivityPanel (request/response JSON + token inspector)
- ExecutionEngine (steps through flows, calls BFF)
- Route serving protocol playground at `/protocol-playground`

**Out of scope (Phase 2+):**
- RAR, PACE, SPIFFE, resource metadata flows
- Advanced features: flow comparison, performance metrics, policy visualization
- Documentation generation (can be added later)

## Success Criteria

✅ **Playground loads** without errors, displays 4 protocols in sidebar  
✅ **Click protocol** → diagram renders + description appears  
✅ **Click Execute** → engine runs all steps sequentially  
✅ **Each step** shows live request/response in ActivityPanel  
✅ **Token inspector** decodes JWT, displays scopes/audiences/expiry  
✅ **Error handling** — if a step fails, show error message + allow retry  
✅ **npm run protocols:gen** works, generates valid `protocolFlows.json`  
✅ **All 4 protocols** are annotated in BFF routes and appear in spec

## Testing Strategy

**Unit tests:**
- TokenInspector: JWT decode, scope extraction, expiry validation
- ExecutionEngine: mock BFF responses, verify step sequencing
- DiagramRenderer: SVG layout for various actor counts

**Integration tests:**
- End-to-end flow execution against running BFF (real /oauth/token, /introspect endpoints)
- Verify token interchange produces valid JWTs

**Manual QA:**
- Execute each protocol flow in UI, inspect tokens visually
- Verify diagram rendering matches BX reference design

## Risk Mitigation

**Risk:** Introspector doesn't parse all route variations (async/middleware-wrapped routes, dynamic routes)  
**Mitigation:** Introspector is conservative — only matches canonical `@flow` tags. Missing routes don't fail; the spec just won't include them. Manual annotation review before Phase 2.

**Risk:** BFF endpoint contracts drift from @expects annotations  
**Mitigation:** ExecutionEngine validates response shape; mismatches show as execution errors. Developers fix annotations or code in response.

**Risk:** Diagram rendering doesn't scale to 20+ step flows  
**Mitigation:** SVG canvas can handle it, but UX degrades. Phase 2 can add flow compression (collapse/expand sub-flows) if needed.

## Open Questions / Deferred

- Should error branches be auto-tested (attempt invalid requests to verify error paths)?
- Should we save execution recordings (capture one full run, replay later for demos)?
- UI styling: match BX reference exactly, or adapt to demo's existing theme?

These can be addressed in Phase 2 or when first feedback arrives.

## References

- **BX Developer Protocol Playground:** https://bx-protocol-playground.ping-devops.com/flows/xaa (reference design)
- **RFC 8693:** Token Exchange specification
- **Existing flows in repo:** demo_api_server/routes/oauthToken.js, /routes/tokenExchange.js, etc.
- **graphify-out/repo-topology.kb.json:** Documented scope topology and token chain flows
