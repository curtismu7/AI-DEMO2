import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';

export default function DPoPPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'What & Why',
      content: (
        <>
          <h3>The problem</h3>
          <p>
            A bearer token is a bearer instrument: whoever holds it can use it. If the delegated
            MCP token leaks &mdash; from a log, memory, or the wire &mdash; an attacker can replay
            it against the gateway or MCP server.
          </p>
          <h3>The solution &mdash; DPoP (RFC 9449)</h3>
          <p>
            <strong>DPoP</strong> (Demonstrating Proof-of-Possession) binds the token to a private
            key the legitimate client holds. The token carries a <code>cnf.jkt</code> claim &mdash;
            the SHA-256 thumbprint (RFC 7638) of the client&apos;s public key &mdash; and every
            request must include a freshly-signed <strong>DPoP proof</strong>. A stolen bearer is
            useless without the matching private key.
          </p>
        </>
      ),
    },
    {
      id: 'proof',
      label: 'Proof Structure',
      content: (
        <>
          <h3>The DPoP proof JWT (RFC 9449 §4)</h3>
          <p>A small JWS signed per request with the client&apos;s private key:</p>
          <ul>
            <li><code>typ: dpop+jwt</code>, <code>alg: ES256</code>, <code>jwk</code>: the public key (header)</li>
            <li><code>htu</code>: target URL &middot; <code>htm</code>: HTTP method</li>
            <li><code>iat</code>: issued-at (short window) &middot; <code>jti</code>: unique id (replay defence)</li>
            <li><code>ath</code>: SHA-256 of the access token, so a proof cannot be moved to a different bearer</li>
          </ul>
          <p>
            The verifier recomputes the key thumbprint from the embedded <code>jwk</code> and checks
            it equals the token&apos;s <code>cnf.jkt</code> &mdash; proving the caller holds the key
            the token is bound to.
          </p>
        </>
      ),
    },
    {
      id: 'flow',
      label: 'In this demo',
      content: (
        <>
          <h3>Flow (behind <code>ff_dpop</code>)</h3>
          <ol>
            <li>BFF mints a per-session ephemeral P-256 key and computes its <code>jkt</code>.</li>
            <li>The delegated MCP token is bound to it &mdash; natively via <code>cnf.jkt</code> on
              PingOne AIC / PingFederate, or (PingOne SaaS) carried in the trusted TraT envelope.</li>
            <li>The BFF signs a fresh DPoP proof per hop (<code>htu</code>/<code>htm</code>/<code>ath</code>).</li>
            <li>The gateway verifies the proof with real crypto and rejects forged / replayed /
              unbound proofs; with <code>REQUIRE_DPOP_PROOF=true</code> it fails closed.</li>
            <li>The gateway bridges the verified outcome to the MCP server (hardened by
              <code>GW_MCP_BRIDGE_SECRET</code>).</li>
          </ol>
        </>
      ),
    },
    {
      id: 'simvsnative',
      label: 'Simulated vs Native',
      content: (
        <>
          <h3>Where <code>cnf.jkt</code> lives</h3>
          <p>
            <strong>Simulated</strong> (PingOne SaaS, the default demo): SaaS does not yet issue
            <code> cnf</code>, so the BFF carries the key thumbprint in the TraT envelope. The proof
            crypto is fully real &mdash; only the binding&apos;s delivery channel differs.
          </p>
          <p>
            <strong>Native</strong> (PingOne AIC / PingFederate 11.2+): <code>cnf.jkt</code> is
            issued in the token itself; the gateway reads it from the token claim.
          </p>
          <p>
            The proof verification path &mdash; signature, <code>htu</code>/<code>htm</code>,
            <code> iat</code> window, <code>jti</code> replay, <code>ath</code>, thumbprint match
            &mdash; is identical in both modes.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="DPoP — Sender-constrained tokens (RFC 9449)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
