// Static content for the 15-minute security-leader demo teleprompter.
// Source of truth: docs/superpowers/specs/2026-07-25-15min-security-leader-demo-script-design.md
// Plain data only — rendered by DemoScriptLauncher. No JSX, no dependencies.

export const DEMO_SCRIPT = {
  audience: "Customer security / engineering leaders",
  surface:
    "Run Acts 1-3 on /use-cases/live. The closer is one hop to /ai-control-plane.",
  preflight: [
    "Run `bash scripts/preflight-demo.sh` about 10 min before showtime.",
    "Log in on local.ping-devops.com:4000 (sign-in only works on that host).",
    "ff_use_cases_launcher ON; NODE_ENV must NOT be production (attack-sim is blocked in prod).",
    "Agent mode toggle visible in the dock (used once, beat 1b).",
    "Closer pre-check: open /ai-control-plane and confirm a LIVE row exists.",
  ],
  intro:
    "AI agents are about to act on behalf of your customers - move money, touch records. The question isn't can they. It's: acting as who, with what limits, and what happens when someone abuses it. Watch.",
  acts: [
    {
      title: "Act 1 - Who is the agent?",
      meta: "~3.5 min · points 1, 2",
      beats: [
        {
          action: "Chip: `show my balance` (UC1)",
          expected:
            "Real balance; token-chain rail shows first exchange + act claim",
          say: "No password handed over. The agent got a token that says it acts for me - the act claim. Every step is attributable to me.",
        },
        {
          action: "Flip mode toggle to Heuristics, re-run `show my balance`",
          expected: "Same act claim, same result (this is the both-modes beat)",
          say: "Same result. Security doesn't care what drives the agent - LLM or deterministic routing, the identity chain is identical.",
        },
        {
          action: "Chip: `what branches are near me` (UC24)",
          expected: "PERMIT, no token exchange",
          say: "Public data - zero token exchange. The agent escalates privilege only when it must. Least privilege by default.",
        },
      ],
    },
    {
      title: "Act 2 - Policy decides",
      meta: "~4 min · point 3 + gateway",
      beats: [
        {
          action: "Type: `transfer $2500 from checking to savings` (UC6)",
          expected: "DENY",
          say: "Money now. $2500. PingOne Authorize returns DENY before the transfer runs - over the ceiling. The agent can't argue.",
        },
        {
          action: "Type: `transfer $300 from checking to savings` (UC8)",
          expected: "HITL_REQUIRED, agent pauses",
          say: "$300 - the agent pauses and waits for a human to approve. It cannot complete this alone.",
        },
        {
          action: "Chip: `what's the weather in Miami` (UC31)",
          expected: "Gateway DENY",
          say: "Different control. The agent calls a third-party weather MCP. Miami is out of policy - the gateway kills the call before the third party ever sees it. Egress control on tool calls.",
        },
      ],
    },
    {
      title: "Act 3 - Attacker fails (the spotlight)",
      meta: "~5 min · points 4, 5",
      beats: [
        {
          action: 'Card "5 · DPoP / replay defense" (UC12), click Run sim',
          expected:
            "Rail: sim-replay-start then sim-gateway-deny, DENY 401 (audience binding)",
          say: "The attack security teams actually lose sleep over. Steal the user's token, replay it straight at the backend, skip the gateway. DENY. The token is audience-bound - worthless anywhere but where it was minted. A stolen token is a dead token.",
        },
        {
          action: 'Card "10 · Insufficient scope" (UC5), click Run sim',
          expected: "Glance DENY; rail DENY 403 (MCP scope)",
          say: "Second attack: an MCP server reaches for a tool it was never scoped for - beyond its job. DENY, 403, at the gateway. Scope is a hard ceiling, not a suggestion. The agent can't grant itself more.",
        },
      ],
    },
  ],
  closer: {
    title: "Close - kill switch (~1.5 min)",
    warn: "One deliberate hop to /ai-control-plane. Use INSTANCE scope (the default) - it self-recovers and is safe for the shared env. Do NOT use full (disables the PingOne app for every user of that client). Do NOT re-run a chip afterward - with instance scope it would just work again.",
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
    "Real LLM (beat 1 only), then switch to Heuristics (one click; same real tools/gateway/policy).",
    "Heuristics is the default for all other beats.",
    "Simulated Authorize (ff_authorize_simulated) with authz-server up - last resort before replay.",
    "REPLAY - 'Show the expected result (REPLAY)' on the failure message; token chain / activity stay empty (live proof only).",
  ],
};
