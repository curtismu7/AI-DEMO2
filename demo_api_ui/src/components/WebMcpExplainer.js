// banking_api_ui/src/components/WebMcpExplainer.js
import React from 'react';
import PageNav from './PageNav';
import { useWebMcpTools } from '../hooks/useWebMcpTools';
import '../styles/appShellPages.css';

/**
 * WebMCP explainer — a Learn page describing the WebMCP browser proposal,
 * with links out to the official site and the Google Chrome Labs tools repo.
 * Mock surface (coverage plan): when the browser implements
 * navigator.modelContext, this page registers two read-only banking tools the
 * in-browser agent can call; otherwise it says so plainly.
 */
const WebMcpExplainer = ({ user, onLogout }) => {
  const { supported, registered } = useWebMcpTools();
  return (
  <div className="app-page-shell">
    <PageNav user={user} onLogout={onLogout} title="WebMCP" />
    <header className="app-page-shell__hero">
      <div className="app-page-shell__hero-top">
        <div>
          <h1 className="app-page-shell__title">WebMCP (Google)</h1>
          <div className="app-page-shell__lead">
            WebMCP is a proposed browser capability that lets a web page expose
            <strong> Model Context Protocol</strong> tools directly to an in-browser AI agent —
            so the agent can act on the page (read state, call tools) without a separate
            server connection.
          </div>
        </div>
      </div>
    </header>

    <div className="app-page-shell__body">
      <section className="app-page-card" style={{ padding: '16px 18px', marginBottom: 16 }}>
        <h2>Live mock surface — this page&apos;s tools</h2>
        {supported ? (
          <>
            <p>
              This browser implements <code>navigator.modelContext</code>. This page has
              registered two read-only banking tools your browser agent can call:
            </p>
            <ul>
              {registered.map((name) => (
                <li key={name}><code>{name}</code> — session-cookie authenticated, read-only</li>
              ))}
            </ul>
            <p className="app-page-shell__muted" style={{ marginTop: 8 }}>
              Calls run with your demo session (same as any BFF fetch); no separate token flow.
              Open the Chrome WebMCP flag and an agent sidebar to see the tools offered.
            </p>
          </>
        ) : (
          <p>
            This browser does not implement <code>navigator.modelContext</code>, so no tools are
            registered. With a WebMCP-enabled browser this page offers{' '}
            <code>get_my_accounts</code> and <code>get_my_transactions</code> — read-only,
            session-authenticated — to the user&apos;s own in-browser agent.
          </p>
        )}
      </section>

      <section className="app-page-card" style={{ padding: '16px 18px', marginBottom: 16 }}>
        <h2>How it relates to this demo</h2>
        <p>
          In AI Demo, MCP tools are served by the <strong>banking MCP server</strong> and
          reached through the Backend-for-Frontend over WebSocket (see <em>Our MCP Server</em> and
          <em> MCP Tools</em>). WebMCP moves that idea into the browser itself: the page declares
          tools the user&apos;s own browser-based agent can call, gated by browser permissions
          rather than a backend session.
        </p>
        <p className="app-page-shell__muted" style={{ marginTop: 8 }}>
          WebMCP is experimental and may require enabling a browser flag or content setting
          (e.g. via <code>chrome://settings/content</code>) before pages can register tools.
        </p>
      </section>

      <section className="app-page-card" style={{ padding: '16px 18px' }}>
        <h2>Learn more</h2>
        <ul>
          <li>
            <a href="https://webmcp.dev/" target="_blank" rel="noopener noreferrer">
              webmcp.dev
            </a>{' '}— overview, spec, and examples
          </li>
          <li>
            <a href="https://github.com/GoogleChromeLabs/webmcp-tools" target="_blank" rel="noopener noreferrer">
              GoogleChromeLabs/webmcp-tools
            </a>{' '}— Google Chrome Labs tooling and demos
          </li>
        </ul>
      </section>
    </div>
  </div>
  );
};

export default WebMcpExplainer;
