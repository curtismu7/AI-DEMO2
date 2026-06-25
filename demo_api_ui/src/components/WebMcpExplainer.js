// banking_api_ui/src/components/WebMcpExplainer.js
import React from 'react';
import PageNav from './PageNav';
import '../styles/appShellPages.css';

/**
 * WebMCP explainer — a Learn page describing the WebMCP browser proposal,
 * with links out to the official site and the Google Chrome Labs tools repo.
 */
const WebMcpExplainer = ({ user, onLogout }) => (
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
        <h2>How it relates to this demo</h2>
        <p>
          In Super Banking, MCP tools are served by the <strong>banking MCP server</strong> and
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

export default WebMcpExplainer;
