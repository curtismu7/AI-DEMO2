// StepDiagramScenes.jsx — one small scene per demo step, drawn with the Demo
// arch slide primitives so they inherit the house style. A scene is a pure
// function of the walkthrough state `st(...ids)` (see DemoArchSlidesPage's
// useSlidePlayer); every numbered walkthrough hop tags its boxes with it.
import { Card, Chip, Win } from './demoArchPrimitives';

const ARROW = { markerEnd: 'url(#das-arrow)' };

function Frame({ title, subtitle, aria, children }) {
  return (
    <svg viewBox="0 0 1240 620" role="img" aria-label={aria} className="das-svg">
      <defs>
        <marker id="das-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="das-cur" />
        </marker>
      </defs>
      <text x="36" y="52" className="das-title">{title}</text>
      <text x="36" y="84" className="das-subtitle">{subtitle}</text>
      {children}
    </svg>
  );
}

function LaneLabel({ x, y, children }) {
  return <text x={x} y={y} className="das-fs11 das-s" style={{ letterSpacing: '0.12em' }}>{children}</text>;
}

function Hop({ x1, y1, x2, y2, label }) {
  return (
    <g>
      <path d={`M${x1} ${y1} L${x2} ${y2}`} className="das-line" {...ARROW} />
      {label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" className="das-fs11 das-s">{label}</text>}
    </g>
  );
}

/* ── Step 2 · Delegated access (consent only) ───────────────────────────── */

export const DELEGATED_ACCESS_META = {
  subtitle: 'RFC 8693 token exchange mints one delegated token · act = agent',
  aria: 'Delegated access: the customer signs in to PingOne, the agent asks the BFF for the balance, the BFF exchanges the user token plus the agent identity for one delegated token, and the gateway checks it with PingOne Authorize before the tool runs.',
  steps: [
    ['Customer signs in', 'OIDC authorization code + PKCE at PingOne. The code returns to the BFF; the browser only ever holds a session cookie.'],
    ['Agent asks for the balance', 'The agent sends the chip request to the BFF — it never holds a password or a browser token.'],
    ['RFC 8693 token exchange', 'The BFF presents the user access token as subject_token and the agent client as actor_token. PingOne mints one delegated token: sub = user, act = agent.'],
    ['Gateway asks Authorize', 'PingGateway introspects the delegated token and asks PingOne Authorize for a decision over sub, act and scopes.'],
    ['Tool runs, chain recorded', 'On PERMIT Banking MCP returns the balance. The token chain shows user → exchange → authorize → tool dispatch.'],
  ],
};

export function StepDelegatedAccessScene({ st }) {
  return (
    <Frame
      title="Delegated access (consent only)"
      subtitle={DELEGATED_ACCESS_META.subtitle}
      aria={DELEGATED_ACCESS_META.aria}
    >
      <LaneLabel x={36} y={130}>Browser · agent</LaneLabel>
      <g {...st(1)}>
        <Win x={40} y={150} w={230} h={70} title="Customer browser" sub="session cookie only" />
      </g>
      <g {...st(2)}>
        <Win x={360} y={150} w={230} h={70} title="Customer agent" sub="no password, no token" />
      </g>

      <LaneLabel x={36} y={330}>BFF · gateways · Ping</LaneLabel>
      <g {...st(3)}>
        <Card x={360} y={350} w={230} h={92} title="BFF (PingAccess)" sub="RFC 8693 exchange">
          <Chip x={376} y={396} w={198} text="subject_token + actor_token" />
        </Card>
      </g>
      <g {...st(4)}>
        <Card x={680} y={350} w={240} h={92} title="PingGateway" sub="introspection + PDP call">
          <Chip x={696} y={396} w={208} text="aud mcp-gw · scopes" />
        </Card>
      </g>
      <g {...st(3)}>
        <Card x={990} y={350} w={210} h={92} title="PingOne AS" sub="mints the delegated token" cls="das-outline-strong">
          <Chip x={1006} y={396} w={178} text="sub=user · act=agent" />
        </Card>
      </g>
      <g {...st(5)}>
        <Card x={680} y={510} w={240} h={70} title="Banking MCP" sub="get_account_balance runs" />
        <Card x={360} y={510} w={230} h={70} title="Token chain" sub="user → exchange → permit → tool" />
      </g>

      <Hop x1={270} y1={185} x2={356} y2={185} />
      <Hop x1={475} y1={224} x2={475} y2={346} label="chip request" />
      <Hop x1={594} y1={396} x2={676} y2={396} label="introspect" />
      <Hop x1={924} y1={396} x2={986} y2={396} label="decision" />
      <Hop x1={475} y1={446} x2={475} y2={506} label="dispatch" />
    </Frame>
  );
}

/* ── Step 3 · ✦ MCP App · transfer approval (HITL consent) ──────────────── */

export const HITL_CONSENT_META = {
  subtitle: 'HITL obligation on a $300 transfer · approval receipt re-evaluated to PERMIT',
  aria: 'Human-in-the-loop consent: the agent attempts a $300 transfer, PingOne Authorize returns a HITL obligation, the gateway pauses the call, the customer approves in a consent modal, and the BFF re-runs the call with a single-use approval receipt.',
  steps: [
    ['Agent attempts the transfer', "create_transfer for $300 goes to the gateway with the delegated token. Nothing is unusual yet."],
    ['Authorize returns HITL', 'The amount falls in the consent band: Authorize answers with a human-in-the-loop obligation instead of PERMIT.'],
    ['Consent modal opens', 'The BFF surfaces the challenge as a modal. The transfer does not run until the user approves.'],
    ['User approves', 'A verified approval receipt bound to user, agent and tool is recorded.'],
    ['Re-evaluated to PERMIT', 'The BFF re-runs the same call carrying the receipt; Authorize sees the obligation satisfied and the transfer executes.'],
  ],
};

export function StepHitlConsentScene({ st }) {
  return (
    <Frame
      title="✦ MCP App · transfer approval"
      subtitle={HITL_CONSENT_META.subtitle}
      aria={HITL_CONSENT_META.aria}
    >
      <LaneLabel x={36} y={130}>Agent</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={220} h={80} title="Customer agent" sub="transfer $300" />
      </g>

      <LaneLabel x={36} y={330}>BFF · gateway · Ping</LaneLabel>
      <g {...st(2)}>
        <Card x={330} y={350} w={230} h={92} title="PingOne Authorize" sub="consent band" cls="das-outline-strong">
          <Chip x={346} y={396} w={198} text="obligation: HITL consent" />
        </Card>
      </g>
      <g {...st(2)}>
        <Card x={640} y={350} w={220} h={92} title="Agent Gateway" sub="pauses the tool call">
          <Chip x={656} y={396} w={188} text="-32002 / hitl_required" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Human</LaneLabel>
      <g {...st(3, 4)}>
        <Card x={40} y={540} w={250} h={64} title="Consent modal" sub="approve $300 to savings" cls="das-outline-strong" />
      </g>
      <g {...st(5)}>
        <Card x={640} y={540} w={250} h={64} title="Transfer executes" sub="receipt-bound re-run → PERMIT" />
      </g>

      <Hop x1={260} y1={190} x2={326} y2={346} label="authorize" />
      <Hop x1={564} y1={396} x2={636} y2={396} label="obligation" />
      <Hop x1={700} y1={446} x2={240} y2={536} label="challenge" />
      <Hop x1={292} y1={572} x2={636} y2={572} label="receipt" />
    </Frame>
  );
}

/* ── Step 4 · MFA step-up (HITL) ────────────────────────────────────────── */

export const MFA_STEPUP_META = {
  subtitle: '$600 clears the step-up threshold, not the deny ceiling · MFA receipt → PERMIT',
  aria: 'MFA step-up: a $600 transfer crosses the step-up threshold, PingOne Authorize returns STEP_UP, the customer completes MFA on their device, and the session is marked step-up verified so the retry is permitted.',
  steps: [
    ['Agent attempts the transfer', "create_transfer for $600 — above the $500 step-up threshold, below the $2,000 deny ceiling."],
    ['Authorize returns STEP_UP', 'authorizeObligations.js classifies the obligation: stepUp wins over consent and hitl.'],
    ['Gateway refuses the call', 'Not authorized · step-up required. No tool ran, no money moved.'],
    ['Customer completes MFA', 'PingOne MFA push on the enrolled device. The BFF marks the session step-up verified.'],
    ['Retry is permitted', 'The same call re-runs; Authorize sees step-up satisfied → PERMIT, and the transfer executes.'],
  ],
};

export function StepMfaStepUpScene({ st }) {
  return (
    <Frame
      title="MFA step-up (HITL)"
      subtitle={MFA_STEPUP_META.subtitle}
      aria={MFA_STEPUP_META.aria}
    >
      <LaneLabel x={36} y={130}>Agent</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={220} h={80} title="Customer agent" sub="transfer $600" />
      </g>

      <LaneLabel x={36} y={330}>BFF · gateway · Ping</LaneLabel>
      <g {...st(2)}>
        <Card x={330} y={350} w={230} h={92} title="PingOne Authorize" sub="$500 ≤ $600 < $2,000" cls="das-outline-strong">
          <Chip x={346} y={396} w={198} text="obligation: STEP_UP" />
        </Card>
      </g>
      <g {...st(3)}>
        <Card x={640} y={350} w={220} h={92} title="Agent Gateway" sub="refuses the call">
          <Chip x={656} y={396} w={188} text="Not authorized · step-up" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Human</LaneLabel>
      <g {...st(4)}>
        <Card x={40} y={540} w={250} h={64} title="MFA on enrolled device" sub="PingOne push → verified" cls="das-outline-strong" />
      </g>
      <g {...st(5)}>
        <Card x={640} y={540} w={250} h={64} title="Transfer executes" sub="step-up verified → PERMIT" />
      </g>

      <Hop x1={260} y1={190} x2={326} y2={346} label="authorize" />
      <Hop x1={564} y1={396} x2={636} y2={396} label="STEP_UP" />
      <Hop x1={700} y1={446} x2={240} y2={536} label="MFA challenge" />
      <Hop x1={292} y1={572} x2={636} y2={572} label="verified session" />
    </Frame>
  );
}

/* ── Step 5 · PAR + RAR intent verified (PERMIT) ────────────────────────── */

export const PAR_RAR_META = {
  subtitle: 'PAR (RFC 9126) pushes the intent · RAR (RFC 9396) caps the amount',
  aria: 'PAR + RAR intent binding: the BFF pushes the transfer intent to the PAR endpoint, PingOne stores the authorization_details grant and returns a request_uri, the token carries the bound details, and Authorize permits only the within-cap transfer.',
  steps: [
    ['Intent is pushed', 'The BFF sends amount and payee to PingOne as a Pushed Authorization Request instead of a plain authorize URL.'],
    ['Grant stored, request_uri back', 'The intent now lives at PingOne, not in the agent. A single-use request_uri references it.'],
    ['Token carries the RAR details', 'The redeemed token embeds authorization_details: transfer cap $500, payee bound.'],
    ['Live request checked', 'At call time the gateway compares the actual transfer against the pushed cap.'],
    ['Within cap → PERMIT', 'Authorize verifies the request against the grant; the chain records the Intent Verified step.'],
  ],
};

export function StepParRarScene({ st }) {
  return (
    <Frame
      title="PAR + RAR intent verified (PERMIT)"
      subtitle={PAR_RAR_META.subtitle}
      aria={PAR_RAR_META.aria}
    >
      <LaneLabel x={36} y={130}>Agent</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={220} h={80} title="Customer agent" sub="transfer $400 within cap" />
      </g>

      <LaneLabel x={36} y={330}>BFF · Ping</LaneLabel>
      <g {...st(1)}>
        <Card x={330} y={350} w={210} h={80} title="BFF" sub="pushes the intent" />
      </g>
      <g {...st(2)}>
        <Card x={610} y={350} w={240} h={92} title="PAR endpoint" sub="RFC 9126" cls="das-outline-strong">
          <Chip x={626} y={396} w={208} text="authorization_details stored" />
        </Card>
      </g>
      <g {...st(3)}>
        <Card x={920} y={350} w={220} h={92} title="Delegated token" sub="carries the RAR grant">
          <Chip x={936} y={396} w={188} text="cap $500 · payee bound" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Decision</LaneLabel>
      <g {...st(4)}>
        <Card x={330} y={540} w={250} h={64} title="Agent Gateway" sub="compares live vs pushed" />
      </g>
      <g {...st(5)}>
        <Card x={660} y={540} w={250} h={64} title="PERMIT · Intent Verified" sub="evidence in the token chain" cls="das-outline-strong" />
      </g>

      <Hop x1={260} y1={190} x2={326} y2={346} label="intent" />
      <Hop x1={544} y1={390} x2={606} y2={390} label="push" />
      <Hop x1={854} y1={390} x2={916} y2={390} label="request_uri" />
      <Hop x1={1030} y1={446} x2={480} y2={536} label="cap check" />
      <Hop x1={584} y1={572} x2={656} y2={572} label="PERMIT" />
    </Frame>
  );
}

/* ── Step 6 · PAR + RAR intent violation (DENY) ─────────────────────────── */

export const RAR_VIOLATION_META = {
  subtitle: 'Same PAR grant as step 5 · live ask exceeds the pushed cap → DENY',
  aria: 'PAR + RAR intent violation: using the same pushed grant, the agent asks for more than it pushed. PingOne Authorize compares the live request to the bound authorization_details and returns DENY before any tool runs.',
  steps: [
    ['Same grant, bigger ask', 'The agent reuses the PAR grant from step 5 but requests $2,500 — more than the $500 cap it pushed.'],
    ['Grant says $500', 'The bound authorization_details live at PingOne: cap $500, payee bound. The token scopes alone would allow the transfer.'],
    ['Live vs pushed compared', 'At call time the gateway hands the actual transfer to PingOne Authorize, which checks it against the stored grant.'],
    ['DENY before the tool', 'The live ask exceeds the pushed intent, so Authorize denies. The gateway stops the call — no tool ran, no money moved.'],
    ['Intent is a contract', 'The DENY lands in the chat and an authorize-decision DENY step lands in the token chain: exceeding the grant fails even with valid scopes.'],
  ],
};

export function StepRarViolationScene({ st }) {
  return (
    <Frame
      title="PAR + RAR intent violation (DENY)"
      subtitle={RAR_VIOLATION_META.subtitle}
      aria={RAR_VIOLATION_META.aria}
    >
      <LaneLabel x={36} y={130}>Agent</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={220} h={80} title="Customer agent" sub="asks $2,500 · grant says $500" cls="das-outline-strong" />
      </g>

      <LaneLabel x={36} y={330}>BFF · Ping</LaneLabel>
      <g {...st(2)}>
        <Card x={330} y={350} w={240} h={92} title="Stored grant (PAR)" sub="RFC 9126 · RFC 9396">
          <Chip x={346} y={396} w={208} text="cap $500 · payee bound" />
        </Card>
      </g>
      <g {...st(3)}>
        <Card x={660} y={350} w={240} h={92} title="PingOne Authorize" sub="live request vs pushed grant" cls="das-outline-strong">
          <Chip x={676} y={396} w={208} text="$2,500 > $500" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Decision</LaneLabel>
      <g {...st(4)}>
        <Card x={330} y={540} w={250} h={64} title="Agent Gateway" sub="stops the call · tool never ran" cls="das-outline-strong" />
      </g>
      <g {...st(5)}>
        <Card x={660} y={540} w={250} h={64} title="DENY · Intent Violated" sub="authorize-decision step in the chain" />
      </g>

      <Hop x1={260} y1={190} x2={326} y2={346} label="transfer $2,500" />
      <Hop x1={574} y1={396} x2={656} y2={396} label="evaluate" />
      <Hop x1={780} y1={446} x2={480} y2={536} label="DENY" />
    </Frame>
  );
}

/* ── Step 7 · Token theft / replay defense (DPoP) ───────────────────────── */

export const DPOP_REPLAY_META = {
  subtitle: 'DPoP proof replay refused · jti cache → DENY 401 invalid_dpop_proof',
  aria: 'Token theft and replay defense: an attacker captures a DPoP-bound token proof and replays it at the gateway. The first use is accepted; the replay is refused with DENY 401 invalid_dpop_proof because the gateway jti cache has already seen the proof.',
  steps: [
    ['Attacker captures a proof', 'A DPoP-bound token and its proof are intercepted — the token itself is valid and unexpired.'],
    ['First use is accepted', 'The gateway verifies the DPoP proof (holder of the private key, htm/htu/iat) and forwards the call.'],
    ['Replay at the gateway', 'The attacker re-sends the identical proof. Audience binding already stops a different service; the same service is the jti cache\'s job.'],
    ['jti cache says seen', 'The gateway\'s replay cache has this proof\'s jti recorded, so the second use is refused.'],
    ['DENY 401 invalid_dpop_proof', 'No tool ran on the replay. The rail shows the 401 and the token chain shows the refused hop.'],
  ],
};

export function StepDpopReplayScene({ st }) {
  return (
    <Frame
      title="Token theft / replay defense (DPoP)"
      subtitle={DPOP_REPLAY_META.subtitle}
      aria={DPOP_REPLAY_META.aria}
    >
      <LaneLabel x={36} y={130}>Attacker</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={230} h={80} title="Captured DPoP proof" sub="valid token · stolen proof" cls="das-outline-strong" />
      </g>

      <LaneLabel x={36} y={330}>Gateway</LaneLabel>
      <g {...st(2)}>
        <Card x={340} y={350} w={230} h={92} title="Use 1 · accepted" sub="proof verified (key holder)">
          <Chip x={356} y={396} w={198} text="jti recorded" />
        </Card>
      </g>
      <g {...st(3, 4)}>
        <Card x={650} y={350} w={230} h={92} title="Use 2 · replay" sub="jti replay cache" cls="das-outline-strong">
          <Chip x={666} y={396} w={198} text="jti already seen" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Outcome</LaneLabel>
      <g {...st(5)}>
        <Card x={340} y={540} w={250} h={64} title="DENY 401" sub="invalid_dpop_proof · no tool ran" cls="das-outline-strong" />
      </g>

      <Hop x1={270} y1={190} x2={336} y2={346} label="use 1" />
      <Hop x1={574} y1={396} x2={646} y2={396} label="replay" />
      <Hop x1={765} y1={446} x2={480} y2={536} label="401" />
    </Frame>
  );
}

/* ── Step 8 · Authz denied ($2,500 over the ceiling) ────────────────────── */

export const AUTHZ_DENIED_META = {
  subtitle: '$2,500 over the policy ceiling · DENY before the tool runs',
  aria: 'Authz denied: the agent attempts a $2,500 transfer over the policy ceiling. PingOne Authorize returns DENY before the tool runs, so no money moves, and the audience sees DENY in the chat and an authorize-decision step in the token chain.',
  steps: [
    ['Agent asks for $2,500', "create_transfer for $2,500 — far above the policy ceiling. The agent's scopes would allow it."],
    ['Gateway calls Authorize', 'The decision is external: PingOne Authorize evaluates the live request, not the agent.'],
    ['DENY — over the ceiling', 'Authorize refuses the amount. The agent cannot argue its way past the policy.'],
    ['Gateway stops the call', 'No tool ran, no money moved — the DENY reaches the chat as the tool result.'],
    ['Decision on the chain', 'The token chain records the authorize-decision step, so the refusal is auditable like every PERMIT.'],
  ],
};

export function StepAuthzDeniedScene({ st }) {
  return (
    <Frame
      title="Authz denied ($2,500 over the ceiling)"
      subtitle={AUTHZ_DENIED_META.subtitle}
      aria={AUTHZ_DENIED_META.aria}
    >
      <LaneLabel x={36} y={130}>Agent</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={220} h={80} title="Customer agent" sub="transfer $2,500" cls="das-outline-strong" />
      </g>

      <LaneLabel x={36} y={330}>Gateway · Ping</LaneLabel>
      <g {...st(2)}>
        <Card x={340} y={350} w={220} h={80} title="Agent Gateway" sub="calls the PDP" />
      </g>
      <g {...st(3)}>
        <Card x={650} y={350} w={240} h={92} title="PingOne Authorize" sub="policy ceiling" cls="das-outline-strong">
          <Chip x={666} y={396} w={208} text="$2,500 > ceiling → DENY" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Outcome</LaneLabel>
      <g {...st(4)}>
        <Card x={340} y={540} w={250} h={64} title="No tool ran" sub="DENY reaches the chat" cls="das-outline-strong" />
      </g>
      <g {...st(5)}>
        <Card x={670} y={540} w={250} h={64} title="Authorize-decision step" sub="recorded on the token chain" />
      </g>

      <Hop x1={260} y1={190} x2={336} y2={346} label="transfer" />
      <Hop x1={564} y1={390} x2={646} y2={390} label="evaluate" />
      <Hop x1={770} y1={446} x2={480} y2={536} label="DENY" />
    </Frame>
  );
}

/* ── Step 9 · A2A delegation (nested act chain) ─────────────────────────── */

export const A2A_DELEGATION_META = {
  subtitle: 'Generalist → specialist · nested act chain, scope narrowed at each hop',
  aria: 'A2A delegation: a generalist agent hands the job to a specialist agent. RFC 8693 nested-act delegation builds a chain of user, then generalist, then specialist, with scope narrowed at each hop, and the specialist tool call returns PERMIT.',
  steps: [
    ['User delegates to the generalist', 'RFC 8693 exchange mints the generalist token: sub = user, act = generalist.'],
    ['Generalist hands off', "The Banking Agent generalist sends the job to the specialist — the user never sees this hop."],
    ['Specialist exchanges again', 'A second RFC 8693 exchange mints the specialist token: act nests the generalist inside the specialist.'],
    ['Scope narrows, never grows', 'Each hop carries less scope than the one before it; the specialist holds only what the handoff granted.'],
    ['PERMIT on the chain', 'PingOne Authorize decides over the nested act chain and the specialist tool call returns PERMIT, visible in the token chain.'],
  ],
};

export function StepA2aDelegationScene({ st }) {
  return (
    <Frame
      title="A2A delegation (nested act chain)"
      subtitle={A2A_DELEGATION_META.subtitle}
      aria={A2A_DELEGATION_META.aria}
    >
      <LaneLabel x={36} y={130}>Agents</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={230} h={80} title="Generalist agent" sub="sub = user · act = generalist" />
      </g>
      <g {...st(2)}>
        <Card x={360} y={150} w={230} h={80} title="Specialist agent" sub="handoff received" cls="das-outline-strong" />
      </g>

      <LaneLabel x={36} y={330}>Ping</LaneLabel>
      <g {...st(3)}>
        <Card x={360} y={350} w={240} h={92} title="RFC 8693 exchange ×2" sub="one per hop" cls="das-outline-strong">
          <Chip x={376} y={396} w={208} text="act = specialist → generalist → user" />
        </Card>
      </g>
      <g {...st(4)}>
        <Card x={690} y={350} w={230} h={92} title="Scope narrowing" sub="each hop holds less">
          <Chip x={706} y={396} w={198} text="only what the handoff granted" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Decision</LaneLabel>
      <g {...st(5)}>
        <Card x={360} y={540} w={250} h={64} title="PERMIT · specialist tool" sub="nested act chain on the record" cls="das-outline-strong" />
      </g>

      <Hop x1={270} y1={190} x2={356} y2={190} label="handoff" />
      <Hop x1={475} y1={234} x2={475} y2={346} label="exchange again" />
      <Hop x1={604} y1={396} x2={686} y2={396} label="narrow" />
      <Hop x1={475} y1={446} x2={475} y2={536} label="authorize" />
    </Frame>
  );
}

/* ── Step 10 · A2A Orchestrator (dynamic specialist pick) ───────────────── */

export const A2A_ORCHESTRATOR_META = {
  subtitle: 'Orchestrator picks the specialist dynamically · same narrowed chain',
  aria: 'A2A Orchestrator: the generalist agent analyzes the request, picks the best specialist dynamically and orchestrates a two-hop delegation with a narrowed nested-act token. The token chain and activity panel update as it unfolds.',
  steps: [
    ['Request lands at the generalist', "The orchestrator analyzes the request — it is not expert in it, so it must route."],
    ['Specialist chosen dynamically', 'The orchestrator picks the best specialist at runtime (CrewAI, heuristic fallback) — no hard-coded task map.'],
    ['Two-hop delegation begins', 'RFC 8693 exchange mints the generalist token, then the specialist token, act nesting at each hop.'],
    ['Narrowed token at the edge', 'The specialist runs with only the scopes the handoff granted, decided by policy not preference.'],
    ['Chain + activity update', 'The token chain and activity panel show the pick, the hops and the PERMIT as they happen.'],
  ],
};

export function StepA2aOrchestratorScene({ st }) {
  return (
    <Frame
      title="A2A Orchestrator (dynamic pick)"
      subtitle={A2A_ORCHESTRATOR_META.subtitle}
      aria={A2A_ORCHESTRATOR_META.aria}
    >
      <LaneLabel x={36} y={130}>Agents</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={230} h={80} title="Generalist agent" sub="analyzes the request" />
      </g>
      <g {...st(2)}>
        <Card x={360} y={150} w={230} h={80} title="Pick a specialist" sub="runtime decision, no task map" cls="das-outline-strong" />
      </g>

      <LaneLabel x={36} y={330}>Delegation</LaneLabel>
      <g {...st(3)}>
        <Card x={360} y={350} w={240} h={92} title="RFC 8693 ×2 hops" sub="act nests at each hop" cls="das-outline-strong">
          <Chip x={376} y={396} w={208} text="generalist → specialist" />
        </Card>
      </g>
      <g {...st(4)}>
        <Card x={690} y={350} w={230} h={92} title="Narrowed specialist token" sub="policy-decided scopes">
          <Chip x={706} y={396} w={198} text="only the granted scopes" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Evidence</LaneLabel>
      <g {...st(5)}>
        <Card x={360} y={540} w={250} h={64} title="Token chain + activity" sub="pick, hops and PERMIT live" cls="das-outline-strong" />
      </g>

      <Hop x1={270} y1={190} x2={356} y2={190} label="analyze" />
      <Hop x1={475} y1={234} x2={475} y2={346} label="delegate" />
      <Hop x1={604} y1={396} x2={686} y2={396} label="narrow" />
      <Hop x1={475} y1={446} x2={475} y2={536} label="record" />
    </Frame>
  );
}

/* ── Step 11 · A2A end to end (protocol + identity) ─────────────────────── */

export const A2A_PROTOCOL_META = {
  subtitle: 'Wire protocol (Agent Card, bearer JSON-RPC) beside the RFC 8693 identity chain',
  aria: 'A2A end to end: a walkthrough page shows the real Agent Card, a real 401 when a JSON-RPC call has no bearer, and a live delegation run that renders two client_credentials tokens, two RFC 8693 exchanges, scope narrowing and act nesting.',
  steps: [
    ['Agent Card for discovery', 'The specialist publishes an Agent Card: what it can do and where to call it. Discovery needs no credential.'],
    ['No bearer → real 401', 'A JSON-RPC message/send without a bearer token is refused — the wire protocol itself is credential-gated.'],
    ['client_credentials ×2', 'Each agent first authenticates itself with its own client_credentials token — machine identity, not user identity.'],
    ['RFC 8693 exchanges ×2', 'Then each hop exchanges for the delegated token: act nests, scopes narrow. This is the identity chain.'],
    ['Both layers in one page', 'Two different credentials for two layers: the wire protocol gates the transport; the act chain proves who acts for whom.'],
  ],
};

export function StepA2aProtocolScene({ st }) {
  return (
    <Frame
      title="A2A end to end (protocol + identity)"
      subtitle={A2A_PROTOCOL_META.subtitle}
      aria={A2A_PROTOCOL_META.aria}
    >
      <LaneLabel x={36} y={130}>Wire protocol</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={230} h={80} title="Agent Card" sub="discovery, no credential" />
      </g>
      <g {...st(2)}>
        <Card x={360} y={150} w={230} h={80} title="JSON-RPC message/send" sub="no bearer → 401" cls="das-outline-strong" />
      </g>

      <LaneLabel x={36} y={330}>Identity chain</LaneLabel>
      <g {...st(3)}>
        <Card x={360} y={350} w={240} h={92} title="client_credentials ×2" sub="machine identity per agent" cls="das-outline-strong">
          <Chip x={376} y={396} w={208} text="who the agent is" />
        </Card>
      </g>
      <g {...st(4)}>
        <Card x={690} y={350} w={230} h={92} title="RFC 8693 ×2" sub="act nests · scopes narrow">
          <Chip x={706} y={396} w={198} text="who the agent acts for" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Two layers</LaneLabel>
      <g {...st(5)}>
        <Card x={360} y={540} w={250} h={64} title="Protocol + identity together" sub="different credentials, one page" cls="das-outline-strong" />
      </g>

      <Hop x1={270} y1={190} x2={356} y2={190} label="discover" />
      <Hop x1={475} y1={234} x2={475} y2={346} label="authenticate" />
      <Hop x1={604} y1={396} x2={686} y2={396} label="delegate" />
      <Hop x1={475} y1={446} x2={475} y2={536} label="both layers" />
    </Frame>
  );
}

/* ── Step 12 · CIBA out-of-band approval ────────────────────────────────── */

export const CIBA_OOB_META = {
  subtitle: '$150, below the MFA threshold · approval on the phone, agent polls',
  aria: 'CIBA out-of-band approval: the agent moves a deliberately small $150 and approval is requested out-of-band on the user\'s own phone. The agent polls and proceeds only after the user approves; the token chain shows authorize-decision, ciba-poll, then tool-dispatched.',
  steps: [
    ['Agent asks for $150', 'Deliberately below the MFA threshold — the trigger is action sensitivity, not a dollar amount.'],
    ['CIBA push to the phone', 'OpenID Connect CIBA sends the approval request to the user\'s own device. The agent has no browser to prompt.'],
    ['Agent polls', 'The agent cannot self-approve: it polls the token endpoint while the user decides out-of-band.'],
    ['User approves on the phone', 'A compromised browser or rogue agent cannot answer for the user — the decision happens off-session.'],
    ['Poll returns the token', 'The ciba-poll step completes, the tool dispatches and the chain shows authorize-decision → ciba-poll → tool-dispatched.'],
  ],
};

export function StepCibaOobScene({ st }) {
  return (
    <Frame
      title="CIBA out-of-band approval"
      subtitle={CIBA_OOB_META.subtitle}
      aria={CIBA_OOB_META.aria}
    >
      <LaneLabel x={36} y={130}>Agent</LaneLabel>
      <g {...st(1)}>
        <Card x={40} y={150} w={220} h={80} title="Customer agent" sub="transfer $150" cls="das-outline-strong" />
      </g>

      <LaneLabel x={36} y={330}>Ping · phone</LaneLabel>
      <g {...st(2)}>
        <Card x={340} y={350} w={230} h={92} title="CIBA push (PingOne)" sub="auth_req_id issued" cls="das-outline-strong">
          <Chip x={356} y={396} w={198} text="approval → user\'s device" />
        </Card>
      </g>
      <g {...st(3)}>
        <Card x={660} y={350} w={230} h={92} title="Agent polls" sub="token endpoint · auth_req_id">
          <Chip x={676} y={396} w={198} text="authorization_pending" />
        </Card>
      </g>

      <LaneLabel x={36} y={520}>Human decides</LaneLabel>
      <g {...st(4)}>
        <Card x={340} y={540} w={250} h={64} title="Approve on the phone" sub="off-session, cannot be spoofed" cls="das-outline-strong" />
      </g>
      <g {...st(5)}>
        <Card x={670} y={540} w={250} h={64} title="Poll → token → tool" sub="authorize → ciba-poll → dispatched" />
      </g>

      <Hop x1={260} y1={190} x2={336} y2={346} label="request" />
      <Hop x1={574} y1={396} x2={656} y2={396} label="poll" />
      <Hop x1={465} y1={536} x2={665} y2={536} label="approved" />
    </Frame>
  );
}
