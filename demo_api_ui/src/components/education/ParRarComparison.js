// Shared PAR-vs-RAR comparison, rendered by both PARPanel and RARPanel.
// The two are routinely conflated because RAR details are usually pushed
// *inside* a PAR request — but they answer different questions:
// PAR is how the request travels, RAR is what the request means.
import React from 'react';

const ROWS = [
  ['OAuth standard', 'RFC 9126', 'RFC 9396'],
  ['Main purpose', 'Securely transport the authorization request', 'Describe precisely what access or action is requested'],
  ['Focus', 'Request delivery and integrity', 'Authorization detail and precision'],
  ['Key parameter', 'request_uri', 'authorization_details'],
  ['Replaces scopes?', 'No', 'No — complements them with structured context'],
  ['Authorizes the API call?', 'No', 'No — the AS evaluates, the resource server enforces'],
];

export default function ParRarComparison() {
  return (
    <>
      <p>
        PAR and RAR solve different problems and are frequently confused, because RAR
        details are normally sent <em>inside</em> a PAR request. The short version:{' '}
        <strong>PAR is about how the request travels; RAR is about what the request means.</strong>
      </p>

      <table className="edu-table">
        <thead>
          <tr>
            <th>Aspect</th>
            <th>PAR</th>
            <th>RAR</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([aspect, par, rar]) => (
            <tr key={aspect}>
              <td><strong>{aspect}</strong></td>
              <td>{par}</td>
              <td>{rar}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Used together</h3>
      <p>
        The client POSTs the whole request — including <code>authorization_details</code> — to the
        PAR endpoint, gets back a short-lived <code>request_uri</code>, and the browser carries only
        that reference. The user then sees a consent screen describing the specific operation
        (&ldquo;initiate a $123.50 payment to Merchant A&rdquo;) rather than a broad scope name.
      </p>
      <p>
        <strong>Neither replaces resource-server enforcement.</strong> PAR protects how the grant was
        established; RAR describes what was granted. The resource server still has to validate the
        token and check that the operation it was handed is covered by the grant — if the client
        later submits $1,000 to a different merchant, only the resource server stops it.
      </p>

      <h3>Ping platform support</h3>
      <ul>
        <li>
          <strong>PingOne SSO</strong> — supports PAR (<code>POST /&#123;envID&#125;/as/par</code>,
          60-second request URI, single use). It does <em>not</em> document native RFC 9396
          processing, so PingOne SSO should not be positioned as providing native RAR.
        </li>
        <li>
          <strong>PingOne Authorize</strong> — makes fine-grained policy decisions, which is not the
          same thing as OAuth RAR support.
        </li>
        <li>
          <strong>AIC / PingAM</strong> — partial RAR support on <code>/authorize</code> and{' '}
          <code>/par</code>, with Remote Consent configuration.
        </li>
        <li>
          <strong>PingFederate</strong> — RAR via configured authorization-detail types and
          processors; custom processing may be required.
        </li>
      </ul>
    </>
  );
}
