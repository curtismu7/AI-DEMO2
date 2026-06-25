// banking_api_ui/src/components/education/RARPanel.js
// Education drawer — Rich Authorization Requests (RFC 9396)
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { EduImplIntro, SNIP_RAR_MOCK } from './educationImplementationSnippets';

const Code = ({ children }) => (
  <code style={{
    display: 'block', background: 'var(--code-bg, #f1f5f9)', borderRadius: 6,
    padding: '0.75rem 1rem', fontFamily: 'inherit', fontSize: '0.78rem',
    whiteSpace: 'pre', overflowX: 'auto', margin: '0.5rem 0',
  }}>{children}</code>
);

export default function RARPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'What is RAR',
      content: (
        <>
          <p>
            <strong>Rich Authorization Requests (RAR)</strong> — RFC 9396 — extend OAuth 2.0 with
            a structured <code>authorization_details</code> parameter that lets clients express
            <em>exactly what they want to do</em> instead of relying on flat scope strings.
          </p>
          <p>
            Classic OAuth uses strings like <code>transfer</code>. RAR allows a structured
            JSON object describing the specific operation, resource, amount, currency, and more:
          </p>
          <Code>{`authorization_details=[
  {
    "type": "payment_initiation",
    "locations": ["https://api.bxfinance.example/payments"],
    "instructedAmount": { "currency": "USD", "amount": "250.00" },
    "creditorName": "Jane Smith",
    "creditorAccount": { "iban": "DE02100100109307118603" },
    "remittanceInformationUnstructured": "Invoice 47"
  }
]`}</Code>
          <p>
            The AS can enforce fine-grained policies against every field before issuing a token,
            and those details are <strong>embedded in the issued access token</strong> so the
            resource server can validate them without an extra DB lookup.
          </p>
        </>
      ),
    },
    {
      id: 'structure',
      label: 'authorization_details',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>The authorization_details parameter</h4>
          <p>
            It is a JSON array of <strong>authorization detail objects</strong>. Each object
            must have a <code>type</code> field; all other fields are type-specific:
          </p>
          <Code>{`{
  "type": "account_information",  // required
  "locations": [                  // optional: resource server URIs
    "https://api.bxfinance.example/accounts"
  ],
  "actions": ["read"],            // optional: what operations
  "identifier": "acct-1234"       // optional: which specific resource
}`}</Code>
          <p>Multiple types can be requested in one authorization:</p>
          <Code>{`authorization_details=[
  { "type": "account_information", "actions": ["read"] },
  { "type": "payment_initiation",
    "instructedAmount": { "currency": "USD", "amount": "50.00" } }
]`}</Code>
          <p>
            The AS validates each object against its registered schema for that type.
            If any are invalid or the user/policy denies them, the entire request fails.
          </p>
        </>
      ),
    },
    {
      id: 'banking',
      label: 'Banking use case',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>RAR for Super Banking / Open Banking</h4>
          <p>
            RAR is the backbone of <strong>Open Banking (PSD2 / Berlin Group)</strong> and
            <strong>FAPI 2.0</strong> APIs. Instead of granting broad "transfer" scope, a
            payment initiator specifies the exact transaction:
          </p>
          <Code>{`authorization_details=[
  {
    "type": "payment_initiation",
    "creditorName": "Super Banking Payee",
    "instructedAmount": {
      "currency": "USD",
      "amount": "125.00"
    },
    "remittanceInformationUnstructured": "Rent May 2026"
  }
]`}</Code>
          <p>
            The issued token is now <strong>transaction-specific</strong>. Even if intercepted,
            it cannot be used to initiate a different transfer or read account statements — the
            resource server enforces the <code>authorization_details</code> claim embedded in the JWT.
          </p>
          <p>
            <strong>AI agent angle:</strong> when the Super Banking Banking Agent initiates a transfer,
            a RAR-aware integration would encode the exact amount and accounts into the
            authorization request, giving the user and the AS a precise picture of what is being
            authorized — aligning with PingOne's "Enforce Least Privilege" best practice.
          </p>
        </>
      ),
    },
    {
      id: 'token',
      label: 'Token claim',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>authorization_details in the access token</h4>
          <p>
            When the AS grants the request, the issued JWT includes the approved
            <code>authorization_details</code>. The resource server validates these without
            making any back-channel call:
          </p>
          <Code>{`{
  "sub": "user-abc",
  "iss": "https://auth.pingone.com/env-id/as",
  "aud": "https://api.bxfinance.example",
  "scope": "openid",
  "authorization_details": [
    {
      "type": "payment_initiation",
      "instructedAmount": { "currency": "USD", "amount": "125.00" },
      "creditorName": "Super Banking Payee"
    }
  ]
}`}</Code>
          <p>
            Compare this to a flat-scope token: the RS only knows the bearer has
            <code>transfer</code> — it cannot verify the amount or destination without a
            side-channel database look-up.
          </p>
        </>
      ),
    },
    {
      id: 'pingone',
      label: 'PingOne / FAPI 2.0',
      content: (
        <>
          <h4 style={{ marginTop: 0 }}>PingOne + RAR</h4>
          <p>
            PingOne supports RAR through <strong>DaVinci flows</strong> and the
            <strong>Advanced Authorization</strong> service. To enable it:
          </p>
          <ol style={{ paddingLeft: '1.25rem', lineHeight: 1.8, fontSize: '0.88rem' }}>
            <li>
              Create a <strong>Resource Server</strong> and define custom
              <code>authorization_details</code> types and their JSON schemas under
              <em>Applications → Resources → Authorization Details Types</em>.
            </li>
            <li>
              In your OAuth application, enable <strong>RAR</strong> and reference the registered
              types as allowed values.
            </li>
            <li>
              Include <code>authorization_details</code> in your authorization request
              (via PAR or directly in the query string).
            </li>
            <li>
              PingOne's DaVinci policy can inspect each field and approve/deny
              based on transaction risk, user tier, or any external policy signal.
            </li>
          </ol>
          <p>
            FAPI 2.0 profiles mandate RAR + PAR together for open-banking grade security.
          </p>
        </>
      ),
    },
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>RAR in Super Banking</h3>
          <EduImplIntro mock>
            Authorization requests from this app do not send <code>authorization_details</code> today; use this shape when integrating a PingOne policy that expects RAR.
          </EduImplIntro>
          <pre className="edu-code">{SNIP_RAR_MOCK}</pre>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Rich Authorization Requests — RAR (RFC 9396)"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(680px, 100vw)"
    />
  );
}
