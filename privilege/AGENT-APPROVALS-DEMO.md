# Human-in-the-loop agent approvals — the demo that works today

October 13, 2026 · demo guide

Privilege's native `agentapprovals` flow: a high-risk agent action becomes an
ApprovalReq, the request lands in the console, and a human's decision is what
lets the action proceed. This guide covers the demoable path and records, for
Ping support, why the notification channels are not part of any demo yet.

## What works (demo-ready, verified live 2026-10-12/13, tenant 0428ba4f)

1. **Create the request.** `POST /api/{tenant}/v1/approvalreqs` — Type `App`,
   an MCP action on an Application resource (e.g. `create_transfer` /
   `grant_admin` on the hostile-mcp-governed app), approvers set, 1h
   `NotAfter`. Status moves New → Pending. The console UI's own minimal
   payload shape is enough.
2. **The human decides.** The approver opens **Access Request Approvals →
   HITL Requests** (`/admin/agent-approvals`) in the console. The request
   appears with tabs Awaiting / Approved / Rejected / Expired / All /
   Archive; Approve/Deny render for the approver identity.
3. **The decision is terminal and auditable.** Per the page's own copy:
   decisions are terminal, grants are time-bound, requests archive after a
   day. The demo story: *the agent pauses, a human decides, the audit shows
   who.*

That loop — request, console decision, time-bound grant — is the feature.
Do the whole demo inside the console and it is complete.

## What does not work (do not demo, do not promise)

**Slack and Mattermost notifications never dispatch on this tenant.** The
flow's notification leg is dead — not degraded: the dispatcher never
attempts delivery, and nothing errors anywhere.

Verified across every cell of the matrix, 2026-10-12 → 10-13:

- Slack bot OAuth `Success` (scopes chat:write, im:*, channels:read, …),
  channel registered with the real Slack channel ID, bot confirmed a member
  of the target channel.
- All wiring variants: Server-0 NotificationSubscription, MedusaNode-scoped
  subscription, and the console bundle's own bot-mode wiring
  (`medusaNodeSlackNotificationChannelRef` set via authorized PUT, verified
  by re-GET).
- All request shapes: UI-minimal, full payload, inline
  ApproverNotifications, per-approver ApproverNotificationRef entries.
- Token states: valid and post-expiry — identical silence. (The console
  hides the re-Authorize button for Slack integrations entirely.)
- 10+ ApprovalReqs over ~12h, including one from 2026-09-16 that predates
  all wiring — zero `SlackMessageTs`, zero events, `Status` never touched.
- Mattermost as an independent channel type: integration validates, bot
  works, same silence.
- Root-cause candidate for both: the agentless tenant has **no MedusaNodes**
  (`ProxyController cmuirlocal` has an empty node list — the
  `privilege-proxy` egress component was never deployed), so notification
  egress likely never runs.

**Ping support report, complete with evidence chain and four questions:**
`~/Desktop/ping-privilege-hitl-notification-bug.md` — file it via the Ping
support portal before promising any channel-based approval demo. (The report
predates the Mattermost teardown; the compose stack is gone, manifests kept
at `~/Development/mattermost-hitl/k8s/mattermost.yaml` for if Ping ships
arm64 images.)

## Demo script (console fallback)

1. Walk the agent hitting a policy-gated dangerous action — the same setup
   as [HOSTILE-MCP-SIDE-BY-SIDE.md](HOSTILE-MCP-SIDE-BY-SIDE.md).
2. Show the ApprovalReq in the console, Awaiting tab: who requested, which
   app/tool, the approvers, the expiry.
3. Approve it as the human approver (never via API — self-approval via PUT
   is refused by the harness by design; the decision belongs to a person).
4. Point at the terminal state and the audit trail: who decided, when, what
   it granted, and when the grant dies.
5. If asked "does it notify Slack?": **"Delivery is an open Ping support
   case; today the approver is notified in the console."** Do not claim
   channel delivery.

## Related records

- Probe memory: `privilege-hitl-track2-probe` (request names
  CarsonRiver/YserRiver/ConnecticutRiver-*, scripts in /tmp/procyon-probe/).
- Track 1 (Recognize as HITL) is parked pending `RECOGNIZE_API_KEY`
  provisioning — separate path, not covered here.
- Approver *Policy* wizard (`/admin/approver-policies`) exists but its
  resource types are INFRA-shaped only (no MCP/agentic-app type) —
  `approvalreqs` (MCP tool grants) and `agentapprovals` (Cedar per-call)
  are different paths; do not conflate them in the demo.
