# CIAM Demo — Agent Types

This is the operator sequence for the CIAM/NHI story aligned to the ID4AI
maturity-model taxonomy. The registration facade is deliberately labeled as
mocked; the execution after registration remains PingOne-backed.

## The story in one sentence

The customer authenticates once, a distinct agent identity is registered and
owned, the Digital Assistant acts on the customer's behalf, and every tool
call preserves the customer subject, agent actor, scope, policy decision, and
lifecycle evidence.

## Agent-type lanes

| Agent type | Entry point | Registration/delegation | What to demonstrate |
|---|---|---|---|
| Consumer & Partner Agent | `/agent-builder` | Mocked CIMD facade; real PingOne agent association | Ownership, metadata provenance, NHI inventory, cleanup |
| Workload Agent: Digital Assistant | `/personal-agent` | Real PingOne workload identity; RFC 8693 OBO | Customer subject + assistant actor, gateway, Authorize, step-up/CIBA |
| Agent Network | A2A delegation / learning flow | Nested RFC 8693 delegation | Generalist-to-specialist trust, narrowed scope, deny on mismatch |
| Employee Personal Agent | Future lane | Dynamic CIMD + user delegation | Native/browser/coding agent registration pattern |
| Workload Agent: Digital Worker | Future lane | Unique workload identity/client credentials | Autonomous enterprise workload governance |
| SaaS-Embedded Agent | Future lane | Vendor/application-managed identity | Application-owned customer experience |

## Recommended live sequence

### 1. Register the Consumer & Partner Agent

1. Sign in through the normal CIAM flow.
2. Open **Agent Builder** (`/agent-builder`).
3. Choose **Build my Agent**.
4. Point out the real PingOne application identity and owner association.
5. Point out **CIMD registration — mocked**. It runs automatically in the
   background; there is no separate registration action for the operator.
6. Open the metadata URL and show that it contains public-safe metadata only.
7. Open NHI inventory and show the PingOne agent id, registration status,
   `cimd-facade` provenance, owner, and lifecycle record.

Say:

> PingOne does not natively perform CIMD/DCR here, so this panel is an honest
> facade for the registration experience. The association and the agent
> identity used later are real demo state.

### 2. Execute through the Workload Agent: Digital Assistant

1. Open **Digital Assistant** (`/personal-agent`).
2. Use the inline assistant or **Pop Out** client; both call the same real
   `/api/agent/invoke` path.
3. Send: `check my miles` for a low-friction permitted action.
4. Open the security rail/token filmstrip and call out:
   - the authenticated customer is the `sub`;
   - the Digital Assistant/personal workload agent is the `act` actor;
   - RFC 8693 narrows the audience and scopes;
   - the gateway and PingOne Authorize decide before the tool runs.
5. Send: `have my agent use my miles for an upgrade` to demonstrate the
   sensitive action and MFA/step-up path.

Say:

> The assistant is not the customer, and it is not an anonymous UI session.
> It has its own workload identity, while the exchanged token preserves the
> customer who authorized the action.

### 3. Show the Agent Network extension

1. Open the A2A delegation or multi-agent learning flow.
2. Run a permitted specialist request.
3. Show the nested actor chain and narrowed specialist scope.
4. Run the identity-mismatch variant.
5. Show that the unregistered or mismatched specialist is denied before the
   protected tool executes.

Say:

> The same CIAM controls extend across agent-to-agent hops: trusted identity,
> least privilege, actor attribution, and fail-closed policy decisions.

## Evidence checklist

At the end of the demo, the operator should be able to show:

- a human CIAM session;
- a distinct PingOne workload-agent identity;
- mocked CIMD registration clearly labeled as mocked;
- user-owned NHI inventory and lifecycle provenance;
- `sub` = customer and `act` = agent in the delegated token;
- gateway and PingOne Authorize evidence;
- step-up or CIBA for a sensitive action;
- nested `act` attribution and denial for an untrusted specialist.

## Finding the CIAM and Privilege lanes in the UI

Use the left navigation search to find the renamed groups without memorizing
the old labels:

- Search `ciam`, `consumer partner`, or `agent builder` for **Identity for AI**
  and **Consumer & Partner Agent Builder**.
- Search `personal agent`, `digital assistant`, or `workload` for the real
  Digital Assistant flow.
- Search `privilege`, `jit`, `pam`, `approval`, `secretless`, `session
  recording`, or `kill switch` for **Privilege & JIT Access**.
- Search `mcp`, `gateway`, or `discovery` for the agent gateway/runtime lanes.

In **Demo Steps**, use the **Consumer & Partner** chip for the CIAM agent
registration story and **Privilege & JIT** for temporary credentials,
approval, session evidence, and revocation. The Privilege lane is a separate
cross-cutting control story: it can be shown alongside any agent type rather
than treated as a fifth agent type.

## Boundaries to state explicitly

- Do not call the CIMD facade native PingOne CIMD/DCR support.
- Do not describe the Digital Assistant as merely a UI skin; its workload
  identity is the security boundary.
- Do not claim Employee Personal Agent, Digital Worker, or SaaS-Embedded Agent
  lanes are implemented until they have their own registration and execution
  evidence.
