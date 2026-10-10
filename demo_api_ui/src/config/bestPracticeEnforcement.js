// bestPracticeEnforcement.js — where the demo ENFORCES each PingOne best practice.
//
// Coverage plan row "Best Practices" (LINK: annotate each practice with the
// attack-lane use case that enforces it). Each practice lists the demo use
// cases whose attack/defense proves the practice is not just advice — run the
// step and the control fires. UC ids are validated against the backend catalog
// by BestPracticesPanel.enforced-by.test.jsx: a renamed or retired UC fails
// that test instead of leaving a dead reference on the panel.

export const PRACTICE_ENFORCEMENT = {
  know: {
    intro: 'Registering the agent is the gate: every attack lane here starts from a client the gateway can attribute.',
    rows: [
      { uc: 'UC16', proves: 'an unregistered impersonator is blocked — the OBO/exchange requirement means a bare stolen token cannot act' },
      { uc: 'UC13', proves: 'actor injection is denied — the act chain ties every call back to the registered agent client' },
      { uc: 'UC43', proves: 'the registration story itself: CIMD client, scoped, sponsored by the signed-in customer' },
    ],
  },
  detect: {
    intro: 'Detection is only real when something acts on it — these lanes show agentic sessions being singled out.',
    rows: [
      { uc: 'UC13', proves: 'the act claim is the detection signal: present on every exchanged MCP token, checked on every call' },
      { uc: 'UC11', proves: 'a bad client is refused at the gateway perimeter before any tool dispatch' },
      { uc: 'UC18', proves: 'per-agent, per-tool rate limits single out one noisy agent without touching the others' },
    ],
  },
  delegate: {
    intro: 'The delegation lane is the strongest proof in the demo: the impersonation paths are closed and tested.',
    rows: [
      { uc: 'UC16b', proves: 'raw user-token forwarding is blocked outright — no code path forwards the human token to MCP' },
      { uc: 'UC16', proves: 'impersonation (OBO bypass attempt) is rejected; the RFC 8693 exchange is mandatory' },
      { uc: 'UC1', proves: 'scope narrowing is visible: the delegated token carries only what the tool needs, and over-reach is denied' },
    ],
  },
  privilege: {
    intro: 'Least privilege is enforced at three doors — scope, per-use-case caps, and the gateway perimeter itself.',
    rows: [
      { uc: 'UC5', proves: 'insufficient scope is denied before the tool runs' },
      { uc: 'UC14', proves: 'the RAR authorization_details amount cap stops a transfer past the granted limit' },
      { uc: 'UC18', proves: 'rate ceilings bound the blast radius of a compromised agent' },
      { uc: 'UC29', proves: 'when token validation itself is unreachable, the gateway fails closed — no silent permit' },
    ],
  },
  hitl: {
    intro: 'Every sensitive path ends at a human: consent, out-of-band approval, or step-up — each one logged.',
    rows: [
      { uc: 'UC8', proves: 'the transfer consent gate: the agent halts until the human approves the specific transfer' },
      { uc: 'UC22', proves: 'CIBA out-of-band approval on the registered device, with the agent polling' },
      { uc: 'UC7', proves: 'step-up MFA escalates the session before the sensitive call completes' },
      { uc: 'UC27', proves: 'consent cannot be forged — a client-supplied approved flag is rejected server-side' },
    ],
  },
};
