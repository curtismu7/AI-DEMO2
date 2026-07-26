// Static content for the 15-minute security-leader demo teleprompter.
// Source of truth: docs/superpowers/specs/2026-07-25-15min-security-leader-demo-script-design.md
// Plain data only — rendered by DemoScriptLauncher. No JSX, no dependencies.
//
// Beat order is 1:1 with SECURITY_DEMO_USE_CASE_IDS (config/demoUseCaseSteps.js):
// step N in the "15-Min Security Demo" workbench group == beat N below, so the
// presenter can read this script or click the numbered stepper and get the same
// sequence. Keep the two in sync when either changes.

export const DEMO_SCRIPT = {
  audience: "Customer security / engineering leaders",
  surface:
    "Run the 15-Min Security Demo group on /use-cases/live top to bottom. Two hops off it: Step 6 (PAR verified) opens /intent-binding-learning, the closer opens /ai-control-plane.",
  preflight: [
    "Run `bash scripts/preflight-demo.sh` about 10 min before showtime.",
    "Log in on local.ping-devops.com:4000 (sign-in only works on that host).",
    "ff_use_cases_launcher ON; NODE_ENV must NOT be production (attack-sim is blocked in prod).",
    "ff_rar and ff_a2a_delegation auto-arm when their step runs - no manual toggle.",
    "Closer pre-check: open /ai-control-plane and confirm a LIVE row exists.",
  ],
  intro:
    "AI agents are about to act on behalf of your customers - move money, touch records. The question isn't can they. It's: acting as who, with what limits, and what happens when someone abuses it. Watch.",
  acts: [
    {
      title: "Act 1 - Who is the agent?",
      meta: "~4 min · identity, across hops",
      beats: [
        {
          ucId: "UC1",
          action: "Step 1 · `show my balance` (UC1)",
          what:
            "Agent reads the user's balance on their behalf — the baseline delegated call.",
          expected:
            "Real balance; token-chain rail shows first exchange + act claim",
          say: "No password handed over. The agent got a token that says it acts for me - the act claim. Every step is attributable to me.",
        },
        {
          ucId: "UC2",
          action: "Step 2 · `hand off to a specialist` (UC2, A2A)",
          what:
            "Generalist agent hands the job to a specialist agent — delegation across a second hop.",
          expected:
            "PERMIT; rail shows a nested act chain - user, then Agent 1, then Agent 2 - scope narrowed at each hop",
          say: "The generalist agent hands the job to a specialist. Watch the token chain - a second exchange nests the act claim: Agent 2 acts for Agent 1, which acts for me. The whole delegation is provable, and each hop gets less scope, not more.",
        },
        {
          ucId: "UC24",
          action: "Step 3 · `what branches are near me` (UC24)",
          what:
            "Agent answers from public branch data — no user token, no privilege escalation.",
          expected: "PERMIT, no token exchange",
          say: "Public data - zero token exchange. The agent escalates privilege only when it must. Least privilege by default. (Trim this step first if the slot runs tight.)",
        },
      ],
    },
    {
      title: "Act 2 - Policy and intent decide",
      meta: "~6 min · policy, PAR intent, gateway",
      beats: [
        {
          ucId: "UC6",
          action: "Step 4 · type `transfer $2500 from checking to savings` (UC6)",
          what:
            "Agent attempts a transfer over the policy ceiling — PingOne Authorize decides, not the agent.",
          expected: "DENY",
          say: "Money now. $2500. PingOne Authorize returns DENY before the transfer runs - over the ceiling. The agent can't argue.",
        },
        {
          ucId: "UC8",
          action: "Step 5 · type `transfer $300 from checking to savings` (UC8)",
          what:
            "Same transfer, under the ceiling but over the auto-approve line — a human must consent.",
          expected: "HITL_REQUIRED, agent pauses",
          say: "$300 - the agent pauses and waits for a human to approve. It cannot complete this alone.",
        },
        {
          ucId: "UC14b",
          action:
            "Step 6 · card 'PAR intent verified' (UC14b) - click Open page, run a within-cap transfer on the intent-binding page",
          what:
            "Agent pushes its intent (amount, payee) to PingOne as a PAR, then transfers within that cap.",
          expected:
            "PERMIT; token chain shows Intent Verified - the request_uri binds the transfer to its amount cap",
          say: "The good path first. Before it acts, the agent pushes its intent - amount and payee - to PingOne as a Pushed Authorization Request, and gets back a request_uri that binds the transaction. Within the cap: PingOne Authorize verifies the pushed intent and PERMITs. The agent can only do what the user pre-approved.",
        },
        {
          ucId: "UC14",
          action: "Step 7 · card 'PAR intent violation' (UC14) - click Run sim",
          what:
            "Same PAR grant, but the agent now asks for more than it pushed — intent is a contract.",
          expected:
            "DENY; Authorize rejects the over-cap request against the pushed authorization_details",
          say: "Same PAR grant, but now the agent asks for more than it pushed. PingOne Authorize compares the live request to the bound intent and DENYs. Intent is a contract - the agent cannot exceed what was pushed, even if its token scopes would otherwise allow it.",
        },
        {
          ucId: "UC31",
          action: "Step 8 · `what's the weather in Miami` (UC31)",
          what:
            "Agent calls a third-party weather MCP for an out-of-policy location — egress control on tool calls.",
          expected: "Gateway DENY",
          say: "Different control. The agent calls a third-party weather MCP. Miami is out of policy - the gateway kills the call before the third party ever sees it. Egress control on tool calls.",
        },
      ],
    },
    {
      title: "Act 3 - Attacker fails (the spotlight)",
      meta: "~3 min · points 4, 5",
      beats: [
        {
          ucId: "UC12",
          action: "Step 9 · card 'DPoP / replay defense' (UC12) - click Run sim",
          what:
            "Attacker steals the user's token and replays it straight at the backend, skipping the gateway.",
          expected:
            "Rail: sim-replay-start then sim-gateway-deny, DENY 401 (audience binding)",
          say: "The attack security teams actually lose sleep over. Steal the user's token, replay it straight at the backend, skip the gateway. DENY. The token is audience-bound - worthless anywhere but where it was minted. A stolen token is a dead token.",
        },
        {
          ucId: "UC5",
          action: "Step 10 · card 'Insufficient scope' (UC5) - click Run sim",
          what:
            "An MCP server reaches for a tool it was never scoped for — scope is a hard ceiling.",
          expected: "Glance DENY; rail DENY 403 (MCP scope)",
          say: "Second attack: an MCP server reaches for a tool it was never scoped for - beyond its job. DENY, 403, at the gateway. Scope is a hard ceiling, not a suggestion. The agent can't grant itself more.",
        },
      ],
    },
  ],
  closer: {
    title: "Close - kill switch (~1.5 min)",
    navPath: "/ai-control-plane",
    navLabel: "Go to AI Control Plane",
    warn: "One deliberate hop to /ai-control-plane. Use INSTANCE scope (the default) - it self-recovers and is safe for the shared env. Do NOT use full (disables the PingOne app for every user of that client). Do NOT re-run a step afterward - with instance scope it would just work again.",
    steps: [
      "Left nav: AI Control Plane.",
      "On the LIVE row, click the red STOP button.",
      "In the confirm modal: keep scope Instance, pick a reason, click Confirm Stop Agent.",
    ],
    expected:
      "Row flips to REVOKED with an ALL AI ACTIVITY HALTED card; the kill destroys the session so you are force-logged-out to sign-in. The forced logout IS the payoff.",
    say: "Everything you saw was attributable to the user - provable at decision time. So when an agent goes bad, you don't negotiate with it. One switch. (click Confirm) It's done. Watch - I'm logged out. The whole surface went dark the instant the agent was revoked. The agent that moved money a minute ago no longer exists.",
  },
  fallback: [
    "Re-run the step once - the agent is deterministic; same real tools, gateway, and policy.",
    "Simulated Authorize (ff_authorize_simulated) with authz-server up - last resort before replay.",
    "REPLAY - 'Show the expected result (REPLAY)' on the failure message; token chain / activity stay empty (live proof only).",
  ],
};

/**
 * ucId -> beat, for surfaces that show per-step copy outside the teleprompter
 * (the "15-Min Security Demo" cards on /use-cases/live read `what` + `expected`
 * from here, so card text and script never drift).
 */
export const DEMO_SCRIPT_BEAT_BY_UC_ID = Object.fromEntries(
  DEMO_SCRIPT.acts.flatMap((act) => act.beats).map((beat) => [beat.ucId, beat]),
);
