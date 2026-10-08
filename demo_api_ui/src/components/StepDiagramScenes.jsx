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
