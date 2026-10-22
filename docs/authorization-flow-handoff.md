# Authorization Flow and Digital Worker: handoff

Last updated 2026-10-22. Written for the next engineer or Claude session picking up `/authorization-flow` and `/digital-worker`.

Live on SE (all verified by content and image digest, not just a 200):

- https://ai-demo.ping-devops.com/authorization-flow
- https://ai-demo.ping-devops.com/authorization-flow?vertical=airlines
- https://ai-demo.ping-devops.com/digital-worker

## 1. What exists

### /authorization-flow (new, this work)

A scripted walkthrough of the "Unmanaged Personal Assistants" reference demo (Darinder Shokar's deck), redrawn on PingOne, in US dollars, per vertical. Chat on the left, a ReactFlow sequence visualiser on the right, and a Step detail region that follows the step being played.

It makes **no live calls**. Every value in the detail panel is illustrative and labelled so. The page says this in its intro.

The six moments (same as the deck):

| # | Moment | What it proves |
|---|---|---|
| 01 | No connection | No connection, no data. Refused at the edge. |
| 02 | Connect | Customer signs in, consent service records live delegation. |
| 03 | Read | Two exchanges, actor, audience and scope enforced on the read. |
| 04 | Pay $25 | Proposal, phone approval (CIBA), signed binding, system of record. |
| 05 | Pay $60 (refused) | The $50 cap is policy, denied before the phone rings. |
| 06 | Revoke, then read | The session outlives the consent, the authority does not. |

Three tokens narrow authority: connect token (exchange input only), delegated token (`sub` = customer, `act` = assistant, 5 min), audience token (the business's own scope vocabulary, 5 min, no onward delegation).

Features: 11 draggable lanes, shared step bar (Simulate, Prev/Next, speed, Reset), clickable step list, vertical selector (11 verticals), light/dark toggle that follows the app theme, detail panel below or beside the diagram.

### /digital-worker (earlier work in this session)

Agent card on top (Attended | Unattended tabs), diagram last. Attended runs the vertical's protected action through the studio with a mock CIBA consent phone. Unattended arms a worker, fires a job, and parks a run over its mandate for phone approval.

## 2. File map

All under `demo_api_ui/src/`.

| File | Purpose |
|---|---|
| `pages/AuthorizationFlowPage.jsx` / `.css` | Page, ReactFlow visualiser, vertical picker, theme and layout toggles. |
| `pages/AuthorizationFlowDetail.jsx` | `AuthorizationFlowDetail` (Step detail) and `StepList`. |
| `pages/authorizationFlowData.js` | `PROFILES` (per vertical), `lanesFor`, `momentsFor`, `STEP_KEYS`, `SLOTS`. |
| `pages/authorizationFlowDetails.js` | `detailFor(key, profile, amount, pay)`: what, why, request, response, token, checks. |
| `pages/__tests__/AuthorizationFlowPage.test.jsx` | 23 tests: data, vertical vocabulary, detail, theme, layout. |
| `routes/PublicRoutes.js`, `App.js` | Route `/authorization-flow`. |
| `components/AdminSideNav.jsx` | Nav entry under the "Digital Worker" group. |
| `components/LearningHub.tsx`, `learning/lessonCatalog.js`, `config/pageGuides.js`, `utils/diagramLinks.js` | Hub card, lesson `authorization-flow-live`, page guide, diagram link. |
| `../demo_api_server/config/auth-requirements.json` | `"/authorization-flow": "public"`. |

Digital Worker: `pages/DigitalWorkerPage.jsx`, `DigitalWorkerRunPanel.jsx`, `DigitalWorkerSignIn.jsx`, `useConsentPhone.jsx`, `digitalWorkerDiagram.js`, `protectedActionLabel.js`, and `PersonalAgentStudioPage.jsx` (props `consentGate`, `reelEmptyState`).

## 3. How the data works

- `PROFILES[vertical]` holds the business name (`org`), the system-of-record lane (`core`), what the assistant reads (`read`: noun, prompt, tool, reply) and what it pays for (`pay`: tool, noun, phrase builders). Tool names are the vertical's real ones (`pay_bill`, `checkout`, `pay_airline_fee`, `create_transfer`...).
- `momentsFor(vertical)` builds the six moments as ordered messages between lanes. `STEP_KEYS` assigns one detail key per step, in order. A length mismatch throws at load.
- `detailFor(key, ...)` builds the detail record. Shared keys (`exchange1-req`, `forward`, ...) switch between read and pay scopes using the moment's `pay` flag.
- **Vertical rule (tested):** nothing outside banking may say bank, balance, ledger, transfer, Steven or Blake. The test scans lanes, moments and every detail record.

### Add a vertical
Add an entry to `PROFILES`. Everything else follows. The tests then check it.

### Add or change a step
Edit the moment in `momentsFor`, update its `STEP_KEYS` list, and add or adjust the key in `DETAILS` (`authorizationFlowDetails.js`). `SLOTS` (longest moment, currently 16) sizes the lanes.

## 4. Pull requests

Authorization Flow: #1698 page, #1711 vertical selector, #1722 step detail, #1728 Learning Hub card.

Digital Worker and related fixes: #1595 build, #1602 redesign, #1610 return-to after sign-in, #1611 dropped duplicate token list, #1614 token refresh on every `/api` route (session loss), #1619 mock consent phone, #1629 per-vertical action naming, #1632 SE PingOne pin guard in `deploy.sh`, #1648 authz-server sidecar on `demo-api-server` (unattended run), #1650 Ping styling, #1652 CPU requests to fit the PV node, #1666 mcp-server D-05 audience override (tool-call 401), #1667 one approval (phone approves the gateway challenge), #1672 Token Chain intro replaced, #1673 diagram of what the demo does, #1674 proof check fed by a flowTraceId (fixes "incomplete").

## 5. Deploy recipe (SE)

1. Merge after CI is green. CI "Build images" builds `ghcr.io/cmuir_pingcorp/ai-demo-frontend:sha-<FULL 40-char sha>`.
2. Re-read the live image first (`kubectl --context us -n ping-devops-cmuir get deploy frontend -o jsonpath=...`), and check the live sha is an ancestor of yours. Another session may have rolled since you looked.
3. `kubectl ... set image deploy/frontend frontend=ghcr.io/cmuir_pingcorp/ai-demo-frontend:sha-<sha>`, then `rollout status`.
4. Verify the pod `imageID` digest equals the built digest (`docker buildx imagetools inspect`), and grep the served bundle for a string from your change. A 200 proves nothing.

The API server (`demo-api-server`) cannot surge: it uses a single read-write EBS volume plus LMDB, so every restart is a short outage. Roll the API before a frontend that sends something the old API rejects.

## 6. Traps already hit

- **Local node_modules:** this machine lacks `@cedar-policy/cedar-wasm` (added by another PR). `App.session` and `App.structure` guard tests fail locally for that reason only. To view a page locally, serve it with a scratch Vite config that aliases `@cedar-policy/cedar-wasm/web` to a stub. Do not commit that config.
- **Design-token ratchet:** `src/__tests__/designTokenRatchet.test.js` counts literal `font-size` and `border-radius` across all CSS. New CSS must use `var(--font-size-*)` and `var(--radius-*)`. When you remove a literal, lower the pin.
- **gitleaks:** a git commit sha in an image tag trips `generic-api-key`. Add the file and line to `.gitleaksignore` (convention in the repo). Never bypass the hook.
- **Test URL leakage:** the page writes `?vertical=` with `history.replaceState`. Tests reset it in `beforeEach`.
- **Playwright smoke scripts:** do not read response bodies in a response handler on the guest page: it caused a phantom "Sign in required" dialog.
- **Worktrees:** `scripts/bootstrap-worktree.sh` symlinks `node_modules`. Do not serve a worktree to a container with that symlink in place.

## 7. Coordination

Another session ("agents-f1") is merging `/personal-agent` and `/personal-agent/learn`. My merged work in `PersonalAgentStudioPage.jsx` must survive that merge:

- props `consentGate` (mock CIBA phone before the Run button) and `reelEmptyState`;
- refs `phoneApproved` and `decideRef` (a phone approval is recorded on the gateway HITL challenge, so no second modal);
- the `executeWorkload` block that sends a `flowTraceId`, opens `openMcpFlowSse`, ingests `mcpAuthorizeEvaluation` and calls `completeTrace`. Dropping it brings the "incomplete" proof toast back;
- the "Open client window" button, which the Digital Worker tests rely on.

## 8. Open work

1. **Live mode for /authorization-flow (agreed, not started).** A "Run live" switch, scripted stays the default. Feasible without PingOne changes for moments 01, 03, 04 and 06 (needs a signed-in session): `/api/agent/invoke` for reads and the payment, delegation grant and revoke via `demo_api_server/routes/delegation.js` and `agentConsent.js`, the existing mock phone for approval, and real decoded tokens from the run's `tokenEvents` in the detail panel. Not yet tried against SE.
2. **The $50 cap (moment 05) needs a PingOne Authorize rule.** Live amount thresholds today are $300 approval, $600 step-up, $2,500 deny. A $50 deny is a policy change on the live tenant. Show the exact rule to the owner and get an OK before touching it.
3. **Unattended run on SE has not been run end to end signed in.** The authz sidecar fix (#1648) is verified from inside the pod (answers 200), not by a real balance-sweep run.
4. **Attended checkout end to end (phone, no modal, no "incomplete" toast)** was shipped and verified by logs and bundle content, not watched signed in.
5. **Tarun's SMS device is deleted on purpose.** Do not re-add it or text him. Attended step-up MFA for his account therefore cannot complete; use the Unattended tab or the mock phone for demos with that account.
6. Diagram text is small at normal widths (11 lanes scaled to fit). The side layout is cramped at 1500px; below is the default for that reason.

## 9. Owner preferences that apply here

- Always give the full `https://` URL for anything to test, on its own line.
- Prove UI changes in a real browser before handing over; no "should work".
- Claude merges its own PRs after CI is green; use the `cmuir_pingcorp` GitHub account.
- Every diagram is ReactFlow with movable boxes, Simulate, Reset and speed control. Changing a diagram means checking the demo and the Learning Hub in the same pass.
- Fonts and copy come only from the Ping brand hub; Montserrat, Ping Red `#d20e0f`, Core Dark `#051727`.
