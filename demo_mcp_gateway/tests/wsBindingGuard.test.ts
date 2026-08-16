'use strict';

/**
 * wsBindingGuard.test.ts (BUGS.md #53)
 *
 * Proves the WebSocket tools/call transport-parity guard: when DPoP
 * (REQUIRE_DPOP_PROOF=true) or Web Bot Auth (wbaMode=enforce) is ENFORCED, a WS
 * tool call is REFUSED (not silently allowed), closing the transport-bypass that
 * let a caller dodge an armed HTTP-header-bound control by choosing WS. When both
 * controls are OFF (defaults), the call proceeds — legitimate WS traffic is
 * unaffected.
 */

import { wsTransportBindingGuard } from '../src/wsBindingGuard';

describe('wsTransportBindingGuard', () => {
  it('allows the call when both controls are OFF (defaults)', () => {
    expect(wsTransportBindingGuard({ requireDpopProof: false, wbaMode: 'off' })).toBeNull();
    expect(wsTransportBindingGuard({ requireDpopProof: false, wbaMode: 'monitor' })).toBeNull();
  });

  it('REFUSES the WS call when DPoP is enforced (control cannot be satisfied on WS)', () => {
    const r = wsTransportBindingGuard({ requireDpopProof: true, wbaMode: 'off' });
    expect(r).not.toBeNull();
    expect(r!.code).toBe(-32001);
    expect(r!.data.error).toBe('invalid_dpop_proof');
    expect(r!.data.login_required).toBe(false);
    // Steers the caller to the transport where the proof can be verified.
    expect(r!.message).toMatch(/POST \/mcp/);
    expect(r!.message).toMatch(/RFC 9449/);
  });

  it('REFUSES the WS call when Web Bot Auth is enforced', () => {
    const r = wsTransportBindingGuard({ requireDpopProof: false, wbaMode: 'enforce' });
    expect(r).not.toBeNull();
    expect(r!.code).toBe(-32001);
    expect(r!.data.error).toBe('invalid_web_bot_auth');
    expect(r!.data.login_required).toBe(false);
    expect(r!.message).toMatch(/RFC 9421/);
  });

  it('does NOT refuse for wbaMode=monitor — monitor is observe-only, not enforced', () => {
    expect(wsTransportBindingGuard({ requireDpopProof: false, wbaMode: 'monitor' })).toBeNull();
  });

  it('surfaces the DPoP rejection first when both controls are enforced', () => {
    const r = wsTransportBindingGuard({ requireDpopProof: true, wbaMode: 'enforce' });
    expect(r).not.toBeNull();
    expect(r!.data.error).toBe('invalid_dpop_proof');
  });
});
