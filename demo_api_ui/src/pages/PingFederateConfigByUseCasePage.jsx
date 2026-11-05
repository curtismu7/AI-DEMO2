import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import './PingFederateConfigByUseCasePage.css';

/**
 * Explainer: every PingFederate object the demo provisions, grouped by use case.
 * Every claim names the provisioning script that creates the object, so it can
 * be checked against the source. Story text lives here; object names/settings
 * mirror scripts/pingfederate/ (do not restate settings that are not in the
 * scripts — this page documents what we configured, not what PF can do).
 */

const USE_CASES = [
  {
    id: 'core',
    name: 'Foundation: the backbone every flow uses',
    script: 'scripts/pingfederate/provision-core.js',
    why: 'Before any use case runs, PingFederate needs the keys, token managers, token-exchange policy and OAuth clients that the rest of the demo assumes exist.',
    objects: [
      {
        name: 'Signing keys: aidemopf-atm-signing, aidemopf-idjag-signing',
        what: 'RSA 2048 key pairs. The first signs all demo access tokens; the second signs ID-JAGs (the A2A SP connections hardcode it).',
      },
      {
        name: 'JWT access token managers: aiDemoPfJwtAtm, aiDemoPfMcpGatewayJwtAtm, aiDemoPfAgentGwJwtAtm',
        what: 'Three token minters, one per audience: the end-user app (aud enduser.ping.demo), the MCP gateway (aud api.ping.demo:3036/mcp) and the agent gateway (aud agentgateway.ping.demo). Issuer/audience come from demoReadinessPingFederateProfiles.json. Each publishes its JWKS so downstream servers can verify.',
      },
      {
        name: 'JWT processor: aiDemoPfAccessSubjectProcessor',
        what: 'Validates incoming access tokens (the subject token of a token exchange) against the banking ATM\u2019s JWKS.',
      },
      {
        name: 'Token exchange policy: aiDemoStandardTePolicy',
        what: 'The RFC 8693 rule for the demo: actorTokenRequired true — every exchanged token must carry an act claim, so a token always proves which client acted on the subject\u2019s behalf. Three mappings (one per ATM) fill act from the actor token\u2019s client id.',
      },
      {
        name: 'Clients: ai-demo-pf-agent-exchange, ai-demo-pf-mcp-exchange, ai-demo-pf-agent-actor, ai-demo-pf-mcp-actor',
        what: 'The four roles of the standard exchange: two exchangers (client_credentials + token_exchange, each pinned to its gateway ATM) and two actor clients holding the machine credential that backs the act claim. Plus ai-demo-pf-introspection for token introspection.',
      },
    ],
  },
  {
    id: 'a2a',
    name: 'UC2 / UC2.5 — A2A delegation through PingFederate',
    script: 'scripts/pingfederate/provision-a2a-sp-connections.sh, provision-a2a-specialist-pf-clients.sh, fix-a2a-idjag-subject-mapping.sh',
    why: 'When the demo runs in PingFederate mode, the 11 A2A specialist agents each need PingFederate to mint ID-JAGs bound to their vertical resource, and the final token must carry the audience the MCP gateway accepts.',
    objects: [
      {
        name: '12 SP connections: aiDemoA2a*Sp (investment, records, purchase, membership, payroll, tax, finaid, supplier, holdings, passenger, identity, gateway)',
        what: 'Each connection says "issue an ID-JAG for this resource audience" (idJagEnabled true, resource https://<aud>.ping.demo). Signing key aidemopf-idjag-signing. The mapping stamps a2a_tenant_id = the PingOne environment id, so gateway policy can tie the ID-JAG to the demo tenant. The 12th connection is the MCP gateway itself.',
      },
      {
        name: '11 specialist OAuth clients (client ids = the PingOne A2A agent UUIDs)',
        what: 'One per vertical Agent-2 app: client_credentials + token_exchange against aiDemoStandardTePolicy, pinned to ATM aiDemoPfMcpGatewayJwtAtm. That pin is not cosmetic — Exchange #2 must mint a token whose aud is the MCP gateway\u2019s; the agent-gateway ATM was rejected with mcp-invalid-audience.',
      },
      {
        name: 'Fix: id-jag processor mapping on aiDemoStandardTePolicy',
        what: 'Repair script: Exchange #2\u2019s subject is the ID-JAG from Exchange #1, but the policy read the subject from Username (an ID-JAG has none), so every specialist call died with missing_sub. The fix adds an id-jag mapping that takes the subject from the ID-JAG\u2019s sub.',
      },
    ],
  },
  {
    id: 'idjag',
    name: 'UC-LEARN9 — ID-JAG / cross-app access (three deployment shapes)',
    script: 'scripts/pingfederate/configure-acme-idp.js, configure-pfpf-se.js, configure-saml-idjag.js, sync-id-jag-trusted-idps.js',
    why: 'The ID-JAG playground demonstrates enterprise-managed MCP authorization in three shapes: an outside company\u2019s IdP, PingFederate-to-PingFederate, and a BFF-signed SAML assertion.',
    objects: [
      {
        name: 'Outside IdP (Acme): acmeIdJagPolicy, acme-agent, acme-idjag-signing, acmeKeyPublisher, SP connections acmeToOauthMcp + acmeToPingFed',
        what: 'Turns a fresh PingFederate into "Acme Corp", an outside issuer. The password-grant + refresh-token exchange policy (actorTokenRequired false, refresh_token subject) lets acme-agent trade its refresh token for an ID-JAG aimed at our MCP authorization servers. The JWKS-publisher ATM plus a STATIC JWKS (only the ID-JAG key — PF verifies by x5t and multiple keys break redemption with "Invalid JWT token") make the ID-JAGs verifiable downstream.',
      },
      {
        name: 'PF-to-PF (SE): SP connection aiDemoPfIdJagAcmeSp on the issuer; idjagFromSePf IdP connection + idjagRedeemerAtm + ai-demo-pf-idjag-redeemer (EXTENSION grant) on the redeemer',
        what: 'One PingFederate issues, a different PingFederate redeems. The issuer\u2019s SP connection names the redeemer as audience (cloned at runtime from the local-PF SP shape). The redeemer trusts the issuer\u2019s JWKS via an OIDC IdP connection (browser SSO disabled — it only learns keys), mints its own tokens in idjagRedeemerAtm, and performs the JWT-bearer redemption with the redeemer client. Expected ID-JAG: iss = issuer PF, aud = redeemer PF, typ oauth-id-jag+jwt.',
      },
      {
        name: 'SAML path: CA trust aidemosamlca, SAML processor aiDemoSaml, policy aiDemoSamlPolicy, client ai-demo-pf-saml',
        what: 'The BFF signs a SAML 2.0 assertion and trades it for an ID-JAG in ONE exchange: subjectTokenType saml2, actorTokenRequired false, subject from SAML_SUBJECT. The CA import is what makes PF trust the BFF\u2019s signature. Per-SP-connection mappings attach the policy to whichever entity the playground mode uses. (Marked UNVERIFIED in the script — not yet run against SE.)',
      },
      {
        name: 'Trusted IdPs sync: OIDC IdP connections idjag-*',
        what: 'The playground\u2019s Config page lists the issuers PF should accept ID-JAGs from; this script mirrors that registry into PingFederate. Browser SSO stays disabled — the connection exists only so PF learns each issuer\u2019s keys for the JWT-bearer grant.',
      },
    ],
  },
  {
    id: 'rar-cimd',
    name: 'UC-LEARN13 — RAR + CIMD (PingFederate 13.1 AI-agent features)',
    script: 'scripts/pingfederate/provision-ai-agent-features.js',
    why: 'Rich authorization requests let the agent\u2019s ask carry a structured intent (a banking transaction); CIMD lets the BFF register clients by serving a metadata document instead of clicking through the console.',
    objects: [
      {
        name: 'CIMD: oauth/cimd/settings enabled + policy aiDemoPfCimdPolicy',
        what: 'CIMD is enabled with an allow-list of exactly one metadata URL (the BFF\u2019s client-metadata.json — no wildcard), PKCE required. Two negative-test policies (mismatch, secret) back the CIMD tester\u2019s broken-document cases. The mkcert root is imported as a trusted CA so PF can fetch the document over HTTPS.',
      },
      {
        name: 'RAR: authorization detail type banking_transaction + processor aiDemoBankingTxnProcessor',
        what: 'A custom processor validates the banking_transaction detail in the request against the signed-in user\u2019s real accounts and limits, fetched live from the BFF (User Limits URL + lookup credential in the vault).',
      },
      {
        name: 'Clients: ai-demo-pf-rar, ai-demo-pf-rar-dpop',
        what: 'Public PKCE clients with authorizationDetailTypes [banking_transaction]. The DPoP variant (requireDpop true) binds the token to a client-held key. Both exist because PF 13.1 gives CIMD clients no detail types — RAR needs its own registered client.',
      },
    ],
  },
  {
    id: 'ciba',
    name: 'UC-LEARN14 — CIBA (human approves out-of-band)',
    script: 'scripts/pingfederate/provision-ciba.js',
    why: 'An agent starts a token flow without a browser: the approval happens on the human\u2019s PingOne MFA device (or, in web-approver mode, on a demo page), then PF mints the token.',
    objects: [
      {
        name: 'CIBA authenticator aiDemoPfCibaP1Mfa (PingOne MFA) / aiDemoPfCibaWebApprover',
        what: 'Reuses the PingOne environment/application of the existing sign-in adapter but pins the PingOne auth policy to mfa_only — the app\u2019s own policies start with a password step the CIBA authenticator cannot answer, which PF 500s on. The web-approver variant hands approval to a human clicking the demo page instead.',
      },
      {
        name: 'CIBA request policy aiDemoPfCibaPolicy',
        what: 'Transaction lifetime 120 s, unsigned login-hint tokens refused; a plain login_hint becomes the hint subject.',
      },
      {
        name: 'Client ai-demo-pf-ciba (web: ai-demo-pf-ciba-web)',
        what: 'CIBA grant only, delivery mode POLL at a 3 s interval, scope restricted to openid, default ATM aiDemoPfJwtAtm. Requires a default access-token mapping on that ATM (sub/Username from USER_KEY) or PF fails with "Default Access Token mapping not configured".',
      },
    ],
  },
];

export default function PingFederateConfigByUseCasePage() {
  return (
    <main className="pfconfig" data-testid="pingfederate-config-by-use-case">
      <PageHeader
        eyebrow="PingFederate · what we configured"
        title="PingFederate config by use case"
        summary="Every PingFederate object this demo provisions, grouped by the use case it serves. Each card names the provisioning script that creates it, so every claim is checkable against the source in scripts/pingfederate/."
        actions={
          <Link className="pfconfig__secondary" to="/pingfederate-id-jag">
            ID-JAG hub
          </Link>
        }
      />

      <section className="pfconfig__intro">
        <p>
          Nothing on this page was clicked by hand: every object below is created (or
          repaired) by an idempotent provisioning script, so a fresh PingFederate can be
          rebuilt from scratch. Object names are exact — they are the names the scripts
          send to the PingFederate admin API.
        </p>
      </section>

      {USE_CASES.map((uc) => (
        <section key={uc.id} className="pfconfig__group" aria-labelledby={`pfconfig-${uc.id}`}>
          <h2 id={`pfconfig-${uc.id}`}>{uc.name}</h2>
          <p className="pfconfig__why">{uc.why}</p>
          <p className="pfconfig__script">
            <span aria-hidden="true">🛠</span> <code>{uc.script}</code>
          </p>
          <ul className="pfconfig__objects">
            {uc.objects.map((obj) => (
              <li key={obj.name} className="pfconfig__object">
                <h3>{obj.name}</h3>
                <p>{obj.what}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="pfconfig__caveats">
        <h2>Caveats</h2>
        <ul>
          <li>
            The SAML and pf-pf scripts carry explicit UNVERIFIED markers — they were
            written against the design and have not been run against the SE PingFederate
            (see docs/runbooks/idjag-pfpf-se.md).
          </li>
          <li>
            The A2A audience list in provision-a2a-sp-connections.sh must stay in sync
            with demo_api_server/config/a2aSpecialists.js and services/scopeTopology.js.
          </li>
        </ul>
      </section>
    </main>
  );
}
