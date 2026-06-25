// demo_api_ui/src/components/education/ElicitationPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

export default function ElicitationPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  const tabs = [
    {
      id: 'what',
      label: 'What is Elicitation',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Servers asking users for more information</h3>
          <p>
            MCP Elicitation is a mechanism that lets MCP servers request additional information from
            users <strong>mid-tool-call</strong> — while processing a <code>tools/call</code> or{' '}
            <code>resources/read</code> request. Instead of failing when it needs more context, the
            server pauses, asks, and resumes once the user responds.
          </p>
          <p>
            The server sends an <code>elicitation/create</code> request to the client. The client
            presents UI to the user, collects a response, and sends it back. Execution then continues
            with the new information.
          </p>

          <h4>Two modes</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Mode</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>When to use</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Data visibility</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Form mode', 'Structured data collection — names, preferences, settings', 'Data passes through the MCP client'],
                ['URL mode', 'Sensitive flows — OAuth, payments, API keys', 'Data does NOT pass through the client'],
              ].map(([mode, use, vis], i) => (
                <tr key={mode} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', fontWeight: 600 }}>{mode}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151' }}>{use}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151' }}>{vis}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>The three response actions</h4>
          <p>
            Every elicitation response uses one of three actions — regardless of mode:
          </p>
          <ul style={{ fontSize: '0.82rem', lineHeight: 1.8 }}>
            <li><strong>accept</strong> — the user explicitly submitted or consented. For form mode, the <code>content</code> field contains the submitted data.</li>
            <li><strong>decline</strong> — the user explicitly rejected the request (e.g. clicked "No", "Reject").</li>
            <li><strong>cancel</strong> — the user dismissed without choosing (closed the dialog, pressed Escape, browser navigated away).</li>
          </ul>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            Servers must handle all three. A decline is not the same as a cancel — design your server logic accordingly.
          </p>

          <h4>Client responsibilities</h4>
          <ul style={{ fontSize: '0.82rem', lineHeight: 1.8 }}>
            <li>Clearly display <strong>which server</strong> is requesting the information</li>
            <li>Always provide a way to decline or cancel</li>
            <li>For form mode: let users review and modify their response before submitting</li>
            <li>For URL mode: show the full URL before navigation and require explicit consent</li>
          </ul>

          <div className="edu-info-box edu-info-box--warning" style={{ marginTop: '1rem' }}>
            Servers <strong>must not</strong> use form mode to request passwords, API keys, access tokens,
            or payment credentials. Those flows must use URL mode so the data never passes through the
            MCP client.
          </div>

          <p style={{ marginTop: '1rem', fontSize: '0.82rem' }}>
            <strong>See also:</strong>{' '}
            <button
              type="button"
              onClick={() => open(EDU.MCP_PROTOCOL, 'what')}
              style={{ background: 'none', border: 'none', color: 'var(--brand-navy)', cursor: 'pointer', padding: 0, textDecoration: 'underline', font: 'inherit' }}
            >
              How the AI banking assistant works (MCP Protocol)
            </button>
          </p>
        </>
      ),
    },
    {
      id: 'form-mode',
      label: 'Form Mode',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Structured in-band data collection</h3>
          <p>
            Form mode elicitation lets a server define a JSON Schema describing what it needs. The
            client renders a form from that schema, validates the user's input, and returns it in the
            response. The schema is intentionally limited to <strong>flat objects with primitive
            properties</strong> — no nested objects, no arrays of objects.
          </p>

          <h4>Supported field types</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Type</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Key constraints</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Formats / notes</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['string', 'minLength, maxLength, pattern', 'format: email | uri | date | date-time'],
                ['number / integer', 'minimum, maximum', '—'],
                ['boolean', '—', 'renders as checkbox'],
                ['enum (single)', 'enum: [...] or oneOf: [{const, title}]', 'renders as select / radio'],
                ['enum (multi)', 'type: array, items.enum or items.anyOf', 'minItems, maxItems'],
              ].map(([type, constraints, notes], i) => (
                <tr key={type} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb' }}><code>{type}</code></td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151', fontSize: '0.78rem' }}>{constraints}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151', fontSize: '0.78rem' }}>{notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            All types support an optional <code>default</code> value. Clients should pre-populate
            form fields from these defaults.
          </p>

          <h4>Full example — contact info request</h4>
          <pre className="edu-code" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>{`// Server sends:
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "elicitation/create",
  "params": {
    "mode": "form",
    "message": "Please provide your contact information",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "name":  { "type": "string", "description": "Your full name" },
        "email": { "type": "string", "format": "email", "description": "Your email address" },
        "age":   { "type": "number", "minimum": 18, "description": "Your age" }
      },
      "required": ["name", "email"]
    }
  }
}

// Client responds (user accepted):
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "action": "accept",
    "content": {
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "age": 30
    }
  }
}

// Client responds (user declined):
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "action": "decline" }
}`}</pre>

          <div className="edu-info-box edu-info-box--warning" style={{ marginTop: '1rem' }}>
            <strong>Security:</strong> never request passwords, API keys, tokens, or payment data via
            form mode. These must use URL mode. "Sensitive" means secrets and credentials — general
            contact info (name, email) is permitted at server discretion.
          </div>
        </>
      ),
    },
    {
      id: 'url-mode',
      label: 'URL Mode',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Out-of-band flows for sensitive interactions</h3>
          <p>
            URL mode sends the user to an external URL to complete an interaction that <strong>must
            not pass through the MCP client</strong>. The classic uses are OAuth flows to third-party
            services, payment processing, and API key entry. The server directs the user; what the
            user does there stays between them and the external service.
          </p>

          <h4>Request shape</h4>
          <pre className="edu-code" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>{`{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "elicitation/create",
  "params": {
    "mode": "url",
    "elicitationId": "550e8400-e29b-41d4-a716-446655440000",
    "url": "https://mcp.example.com/ui/connect",
    "message": "Authorize access to your GitHub account to continue."
  }
}`}</pre>

          <h4>Response and completion flow</h4>
          <pre className="edu-code" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>{`// Client responds when user consents to open URL:
{ "result": { "action": "accept" } }
// Note: accept means consent to navigate, NOT that the flow is done.

// Server sends when out-of-band flow completes (optional):
{
  "jsonrpc": "2.0",
  "method": "notifications/elicitation/complete",
  "params": { "elicitationId": "550e8400-e29b-41d4-a716-446655440000" }
}`}</pre>

          <h4>Client safe-URL rules</h4>
          <ul style={{ fontSize: '0.82rem', lineHeight: 1.8 }}>
            <li><strong>Do not</strong> auto-fetch or pre-load the URL</li>
            <li><strong>Do not</strong> open the URL without explicit user consent</li>
            <li><strong>Show the full URL</strong> (and highlight the domain) before the user consents</li>
            <li>Open in a <strong>secure browser context</strong> — on iOS, <code>SFSafariViewController</code> yes, <code>WKWebView</code> no. The LLM must not be able to inspect the page content or user inputs.</li>
            <li>Warn for ambiguous/Punycode URIs</li>
          </ul>

          <h4>The phishing attack (and how to prevent it)</h4>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            Without mitigation, a malicious user (Alice) could trigger an elicitation URL, then
            trick another user (Bob) into clicking it. Bob completes the OAuth flow — but the tokens
            get bound to Alice&apos;s session. To prevent this:
          </p>
          <ol style={{ fontSize: '0.82rem', lineHeight: 1.8 }}>
            <li>The server generates a URL to its own endpoint (e.g. <code>/connect?elicitationId=...</code>), not directly to the third-party authorization server.</li>
            <li>When the user loads that page, the server checks their session cookie and verifies the <code>sub</code> claim matches the user who triggered the elicitation.</li>
            <li>Only after confirming identity does the server redirect to the third-party authorization endpoint.</li>
          </ol>

          <div className="edu-info-box" style={{ marginTop: '1rem', fontSize: '0.82rem' }}>
            URL mode is <strong>not</strong> for authorizing the MCP client to the MCP server — that
            is handled by{' '}
            <a href="https://modelcontextprotocol.io/specification/draft/basic/authorization" target="_blank" rel="noopener noreferrer">
              MCP authorization
            </a>
            . URL mode is for the MCP server obtaining third-party access on behalf of the user.
          </div>

          <p style={{ marginTop: '1rem', fontSize: '0.82rem' }}>
            Reference:{' '}
            <a href="https://modelcontextprotocol.io/specification/draft/client/elicitation" target="_blank" rel="noopener noreferrer">
              MCP Elicitation specification (draft)
            </a>
          </p>
        </>
      ),
    },
    {
      id: 'in-repo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Elicitation in the banking demo</h3>
          <p>
            The demo MCP server (<code>demo_mcp_server/</code>) does not currently implement
            elicitation — all tool calls resolve without requesting additional user input. This tab
            describes where the wiring would live if elicitation were added.
          </p>

          <h4>Where it would be handled</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Layer</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>File</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #334155' }}>Role</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['MCP Server', 'demo_mcp_server/src/tools/BankingToolProvider.ts', 'Emits InputRequiredResult from a tool handler when it needs more info'],
                ['BFF WebSocket client', 'demo_api_server/services/mcpWebSocketClient.js', 'Intercepts InputRequiredResult mid-stream, surfaces elicitation/create to the UI layer'],
                ['BFF route', 'demo_api_server/routes/mcp.js', 'Could relay elicitation requests to the browser via SSE'],
                ['React UI', 'demo_api_ui/src/components/BankingAgent.js', 'Would render the elicitation form or URL consent dialog inline in the agent sidebar'],
              ].map(([layer, file, role], i) => (
                <tr key={layer} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', fontWeight: 600 }}>{layer}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb' }}><code style={{ fontSize: '0.75rem' }}>{file}</code></td>
                  <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', color: '#374151' }}>{role}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Protocol reference</h4>
          <p style={{ fontSize: '0.82rem' }}>
            <a href="https://modelcontextprotocol.io/specification/draft/client/elicitation" target="_blank" rel="noopener noreferrer">
              MCP Elicitation specification (draft)
            </a>
            {' — '}covers form mode, URL mode, the request/response schema, completion notifications,
            security considerations, and the phishing mitigation pattern.
          </p>

          <p style={{ fontSize: '0.82rem', marginTop: '0.5rem' }}>
            <strong>See also:</strong>{' '}
            <button
              type="button"
              onClick={() => open(EDU.MCP_PROTOCOL, 'handshake')}
              style={{ background: 'none', border: 'none', color: 'var(--brand-navy)', cursor: 'pointer', padding: 0, textDecoration: 'underline', font: 'inherit' }}
            >
              MCP Protocol — Handshake sequence
            </button>
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="MCP Elicitation"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
