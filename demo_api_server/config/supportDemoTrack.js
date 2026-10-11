'use strict';
/**
 * Support-console demo track — the operator delegation ceremony as three
 * presenter steps. Same shape as config/demoTrack.js TRACK_STEPS; slots fill
 * ONLY from the real ceremony's outcomes (observeSupportEvent), never from
 * UI state. Spec: docs/superpowers/specs/2026-10-11-support-console-real-delegation-design.md
 */
const SUPPORT_TRACK_STEPS = [
  {
    stepId: 'support-verify', act: 1, trackId: 'support', title: 'Verify the customer — real sign-on',
    capability: 'pi.flow · MFA',
    buyerStory: 'Before an operator touches customer data, the customer proves their identity with a real sign-on.',
    slots: {
      green: { source: 'support', event: 'token-issued' },
      red: { source: 'support', event: 'otp-invalid' },
    },
    proved: {
      green: 'The customer completed a real PingOne sign-on — password + one-time code on their own device. The token lives server-side in the operator session.',
      red: 'A wrong code was refused by PingOne — the ceremony cannot be talked past.',
      sayThis: 'Identity proofing happens before authority does — the operator acts only for a customer who proved themselves.',
    },
  },
  {
    stepId: 'support-exchange', act: 1, trackId: 'support', title: 'Act on their behalf — RFC 8693',
    capability: 'RFC 8693 · act claim',
    buyerStory: 'The write must carry proof of who acted for whom — minted live, not asserted.',
    slots: {
      green: { source: 'support', event: 'exchange-ok' },
      red: { source: 'support', event: 'exchange-failed' },
    },
    proved: {
      green: 'PingOne minted a delegated token with act.sub = the admin client — the operator acted FOR the customer, cryptographically.',
      red: 'No ceremony token, no exchange — the write was refused before anything ran.',
      sayThis: 'Delegation is a token property, not a UI state.',
    },
  },
  {
    stepId: 'support-write', act: 1, trackId: 'support', title: 'The write — under the delegated token',
    capability: 'Audit · act provenance',
    buyerStory: 'Every operator action is attributable to a real human through the delegated token.',
    slots: {
      green: { source: 'support', event: 'write-ok' },
      red: { source: 'support', event: 'write-denied' },
    },
    proved: {
      green: 'The write succeeded and the audit records act.sub and the token\'s jti.',
      red: 'Without the ceremony the write was refused — the control is the gate, not the form.',
      sayThis: 'Accountability: who acted, for whom, on what evidence.',
    },
  },
];

function getSupportTrackDefinition() {
  return { steps: SUPPORT_TRACK_STEPS.map((s, i) => ({ ...s, n: i + 1 })) };
}

module.exports = { SUPPORT_TRACK_STEPS, getSupportTrackDefinition };
