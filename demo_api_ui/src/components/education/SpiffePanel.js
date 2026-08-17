// demo_api_ui/src/components/education/SpiffePanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { EduImplIntro } from './educationImplementationSnippets';

const TH = { textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #cbd5e1', fontSize: '0.78rem', color: '#1f2937' };
const TD = { padding: '6px 10px', borderBottom: '1px solid #e5e7eb', fontSize: '0.78rem', color: '#374151', verticalAlign: 'top' };
const YES = { ...TD, color: '#15803d', fontWeight: 700 };
const NO = { ...TD, color: '#b91c1c', fontWeight: 700 };

const ID_VS_DOCUMENT = `        SPIFFE ID  —  the name
        spiffe://bxfinance.demo/agent
                    |
        wrapped and cryptographically signed
                    |
        SVID  —  the document that proves it
        (an X.509 certificate, or a JWT)`;

export default function SpiffePanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    // ── What & Why ──────────────────────────────────────────────────────────
    {
      id: 'what',
      label: 'What & Why',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>An SVID is an ID card for software, not for people</h3>
          <p>
            <strong>SVID</strong> stands for <strong>SPIFFE Verifiable Identity Document</strong>.
            SPIFFE (Secure Production Identity Framework For Everyone) is a CNCF standard for
            giving a <em>running workload</em> — a process, a container, an AI agent — a
            cryptographically verifiable identity, with no shared secret anywhere.
          </p>

          <h4>Two things, often confused</h4>
          <pre className="edu-code">{ID_VS_DOCUMENT}</pre>
          <p>
            The <strong>SPIFFE ID</strong> is a URI: a trust domain plus a path. It is the
            workload&apos;s name, the way an email address is a person&apos;s name. The{' '}
            <strong>SVID</strong> is the signed credential that proves the workload owns that name.
          </p>

          <h4>Two formats</h4>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 14 }}>
            <thead>
              <tr><th style={TH}>Format</th><th style={TH}>What it is</th><th style={TH}>Used for</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style={TD}><strong>X.509-SVID</strong></td>
                <td style={TD}>A short-lived TLS certificate carrying the SPIFFE ID in the SAN</td>
                <td style={TD}>mTLS between services — both sides present one and verify the other</td>
              </tr>
              <tr>
                <td style={TD}><strong>JWT-SVID</strong></td>
                <td style={TD}>A short-lived signed JWT whose <code>sub</code> is the SPIFFE ID</td>
                <td style={TD}>Layer-7 HTTP/REST calls, API gateway authorization, bearer/actor tokens</td>
              </tr>
            </tbody>
          </table>

          <h4>How a workload gets one — attestation, not passwords</h4>
          <p>
            This is the part that makes SPIFFE different. The issuer never asks the workload{' '}
            <em>&quot;what is your secret?&quot;</em> — it looks at <em>what the process actually is</em>.
          </p>
          <ol style={{ paddingLeft: 20, lineHeight: 1.75, fontSize: '0.85rem', color: '#374151' }}>
            <li>
              <strong>Attestation.</strong> The workload starts and calls a local Workload API
              (typically a Unix domain socket — no credentials needed to call it). The issuing
              engine, usually SPIRE, inspects the caller: process UID, container image, Kubernetes
              namespace and service account, cloud instance metadata, binary hash.
            </li>
            <li>
              <strong>Issuance.</strong> If the runtime evidence matches a registration entry, the
              engine returns an SVID valid for a very short window — commonly 5 minutes.
            </li>
            <li>
              <strong>Usage.</strong> The workload presents the SVID to open an mTLS connection or
              to call an API.
            </li>
            <li>
              <strong>Auto-rotation.</strong> A background daemon or sidecar silently renews the
              SVID in memory before it expires. The workload never handles, stores, or rotates a
              raw secret.
            </li>
          </ol>

          <h4>Against the thing it replaces</h4>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 14 }}>
            <thead>
              <tr><th style={TH}>&nbsp;</th><th style={TH}>Static API key / client secret</th><th style={TH}>SVID</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style={TD}><strong>Lifespan</strong></td>
                <td style={TD}>Months to years</td>
                <td style={TD}>Minutes, auto-rotating</td>
              </tr>
              <tr>
                <td style={TD}><strong>Storage</strong></td>
                <td style={TD}>Hardcoded, or in a <code>.env</code> file / secrets manager</td>
                <td style={TD}>Process memory, fetched from a local API socket</td>
              </tr>
              <tr>
                <td style={TD}><strong>Blast radius if leaked</strong></td>
                <td style={TD}>High — full access until someone notices and revokes</td>
                <td style={TD}>Low — the credential expires in minutes</td>
              </tr>
              <tr>
                <td style={TD}><strong>Provenance</strong></td>
                <td style={TD}>Anyone holding the string can impersonate the workload</td>
                <td style={TD}>Bound to the specific running binary and host by attestation</td>
              </tr>
              <tr>
                <td style={TD}><strong>Auditability</strong></td>
                <td style={TD}>Blurry — who used the shared key?</td>
                <td style={TD}>Clear delegation chains for agent-to-agent calls</td>
              </tr>
            </tbody>
          </table>

          <h4>Why this matters specifically for AI agents</h4>
          <ul style={{ paddingLeft: 20, lineHeight: 1.7, fontSize: '0.85rem', color: '#374151' }}>
            <li>
              <strong>Exfiltration.</strong> If an agent is prompt-injected or its memory is
              compromised, a leaked static key grants indefinite access. A leaked SVID is dead in
              minutes.
            </li>
            <li>
              <strong>Ephemerality.</strong> Sub-agents spawn to solve one task and exit. Issuing
              each a permanent credential creates credential bloat nobody ever cleans up.
            </li>
            <li>
              <strong>Delegation audit.</strong> When agent A calls agent B, the audit trail needs
              proof of who called what — not the agents&apos; self-reported labels.
            </li>
          </ul>
        </>
      ),
    },

    // ── In this repo ────────────────────────────────────────────────────────
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>What is real here, and what is not</h3>

          <h4>The SPIFFE routes are a claim-shape simulation</h4>
          <EduImplIntro mock>
            <code>demo_api_server/routes/spiffeDemo.js</code> exposes{' '}
            <code>POST /api/demo/spiffe/svid</code> and <code>/verify</code> over plain HTTP with a
            fake <code>spire-demo://demo.local</code> issuer. Real SPIFFE issues SVIDs over a local
            Workload API socket and presents them via mTLS — there is no bearer HTTP call in
            production SPIFFE. The routes exist so the Protocol Playground can show what a workload
            receives and what a peer checks. They are not workload attestation.
          </EduImplIntro>

          <h4>What is genuinely implemented</h4>
          <EduImplIntro repoPath="demo_api_server/services/clientAssertionService.js">
            <code>private_key_jwt</code> (RFC 7521 / 7523) client authentication — the BFF signs a
            60-second assertion with a private key instead of sending a client secret. The same
            pattern runs in <code>agent_token_service/src/pingoneAgentToken.ts</code> (&quot;Mode B
            PKI&quot;) and <code>demo_agent_service/src/agentIdentity.ts</code>. This is the
            existing seam an SVID-sourced key would plug into. Gated by{' '}
            <code>ff_token_auth_private_key_jwt</code>.
          </EduImplIntro>

          <pre className="edu-code">{`// clientAssertionService.buildClientAssertion() — what PingOne accepts today
{
  "iss": "<pingone client_id>",   // must equal the client_id
  "sub": "<pingone client_id>",   // must equal the client_id
  "aud": "<token endpoint>",
  "exp": now + 60
}
// header: { alg: "RS256", kid }
//
// A SPIFFE ID could ride along as an extra claim — but PingOne would
// ignore it. The client_id is what authenticates.`}</pre>

          <h4>mTLS: one hop, built, deliberately off</h4>
          <EduImplIntro repoPath="oauth-mcp/src/auth/mtlsMiddleware.ts">
            The gateway-to-MCP-server hop can run mutual TLS, pinning the gateway certificate by
            SHA-256. <code>MCP_MTLS_ON</code> is the single master switch and is currently empty
            (off) because the Privilege MCP console-configured backend breaks against an mTLS
            listener — see <code>privilege/PRIVILEGE-MCP.md</code>. Certificates come from{' '}
            <code>scripts/ensure-gateway-mtls-certs.sh</code>, not from any attestation authority.
          </EduImplIntro>

          <h4>Proof-of-possession: DPoP, not certificate binding</h4>
          <EduImplIntro repoPath="demo_mcp_gateway/src/dpopVerify.ts">
            The only sender-constraining mechanism built here is DPoP (RFC 9449), which binds a
            token to a key via the <code>cnf.jkt</code> thumbprint. Signer is{' '}
            <code>demo_api_server/services/dpopKeyService.js</code>. RFC 8705 certificate-bound
            access tokens (<code>cnf</code> with <code>x5t#S256</code>) are not implemented anywhere
            in this repo — <code>docs/RFC-STANDARDS.md</code> states so explicitly.
          </EduImplIntro>

          <h4>What is missing for real SPIFFE</h4>
          <ul style={{ paddingLeft: 20, lineHeight: 1.7, fontSize: '0.85rem', color: '#374151' }}>
            <li>No SPIRE server or agent, so no attestation and no rotation.</li>
            <li>No Workload API socket, so nothing fetches an SVID at runtime.</li>
            <li>No X.509-SVID: the mTLS certificates are statically generated by shell scripts.</li>
            <li>
              No <code>spiffe://</code> URI in any runtime configuration — the workload identity map
              in <code>docs/SPIFFE_PLAN.md</code> is aspirational.
            </li>
          </ul>
        </>
      ),
    },

    // ── What PingOne can consume ────────────────────────────────────────────
    {
      id: 'pingone',
      label: 'What PingOne can consume',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>PingOne is a closed trust domain</h3>
          <p>
            The natural ambition is to hand a SPIRE-issued SVID straight to PingOne. Most of that is
            not possible today, and the reasons are worth knowing before designing around them.
          </p>

          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 14 }}>
            <thead>
              <tr><th style={TH}>Capability</th><th style={TH}>PingOne</th><th style={TH}>Why it matters</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style={TD}><code>private_key_jwt</code> with a registered <code>jwksUrl</code></td>
                <td style={YES}>Supported</td>
                <td style={TD}>
                  The one real opening. Point the app&apos;s <code>jwksUrl</code> at SPIRE&apos;s
                  OIDC Discovery Provider and sign with an SVID-issued key. Constraint:{' '}
                  <code>RS256/384/512</code> only, and the assertion&apos;s <code>iss</code> and{' '}
                  <code>sub</code> must both equal the PingOne <code>client_id</code>.
                </td>
              </tr>
              <tr>
                <td style={TD}>SPIRE-issued JWT as <code>subject_token</code> / <code>actor_token</code></td>
                <td style={NO}>Not supported</td>
                <td style={TD}>
                  PingOne validates that the issuer of both exchange tokens matches the issuer of
                  the current PingOne environment. There is no trusted-external-issuer object in
                  the authorization server, so a JWT-SVID can never become the actor in an RFC 8693
                  exchange.
                </td>
              </tr>
              <tr>
                <td style={TD}>RFC 8705 mTLS client authentication</td>
                <td style={NO}>Not supported</td>
                <td style={TD}>
                  Four token-endpoint auth methods exist and none is mTLS, so an X.509-SVID cannot
                  authenticate the client directly.
                </td>
              </tr>
              <tr>
                <td style={TD}>Certificate-bound tokens (<code>cnf</code> / <code>x5t#S256</code>)</td>
                <td style={NO}>Not supported</td>
                <td style={TD}>
                  Absent from the environment&apos;s discovery document. Combined with no DPoP
                  support, every PingOne access token in the chain is a bearer token.
                </td>
              </tr>
              <tr>
                <td style={TD}><code>act</code> claim on the issued token</td>
                <td style={TD}><strong>Supported, not automatic</strong></td>
                <td style={TD}>
                  Requires a custom resource attribute named <code>act</code> driven by a PingOne
                  Expression Language expression, plus a matching <code>may_act</code> claim on the
                  subject token.
                </td>
              </tr>
              <tr>
                <td style={TD}>SPIFFE / SPIRE integration</td>
                <td style={TD}><strong>PingFederate only</strong></td>
                <td style={TD}>
                  PingFederate&apos;s JWT Token Processor 2.0 can trust the SPIRE OIDC Discovery
                  Provider as an issuer, accept the JWT-SVID as an actor token, and land the full{' '}
                  <code>spiffe://</code> URI in <code>act.sub</code>. The equivalent PingOne guidance
                  uses client secrets and does not mention SPIFFE.
                </td>
              </tr>
            </tbody>
          </table>

          <h4>What that leaves</h4>
          <p>
            One genuine win is available on PingOne cloud: <strong>delete a static client
            secret</strong>. Register the workload&apos;s PingOne application with{' '}
            <code>private_key_jwt</code> and a <code>jwksUrl</code> pointing at SPIRE, and have the
            workload sign its client assertion with a SPIRE-issued, auto-rotating key. Nothing
            long-lived stays on disk.
          </p>
          <p>
            The SPIFFE ID itself survives only as a decorative claim — PingOne authenticates the{' '}
            <code>client_id</code>, not the workload identity. Getting a{' '}
            <code>spiffe://</code> URI into a real <code>act</code> chain requires PingFederate.
          </p>
          <p style={{ fontSize: '0.8rem', color: '#374151', borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
            One practical trap worth recording: SPIRE commonly defaults to EC P-256 keys, and
            PingOne accepts <code>RS256/384/512</code> only. SPIRE must be configured to mint
            RSA-2048 or the client assertion is rejected.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="SPIFFE / SVID — cryptographic workload identity"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
