import React, { useState } from "react";
import { useThemeOptional } from "../context/ThemeContext";
import DashboardSection from "./agenticAccessConsole/DashboardSection";
import AgentsSection from "./agenticAccessConsole/AgentsSection";
import ServersSection from "./agenticAccessConsole/ServersSection";
import PoliciesSection from "./agenticAccessConsole/PoliciesSection";
import AuthSection from "./agenticAccessConsole/AuthSection";
import TokenExchangeSection from "./agenticAccessConsole/TokenExchangeSection";
import AiBrokerSection from "./agenticAccessConsole/AiBrokerSection";
import CibaSection from "./agenticAccessConsole/CibaSection";
import VerticalsSection from "./agenticAccessConsole/VerticalsSection";
import "./AgenticAccessConsolePage.css";

/**
 * AgenticAccessConsolePage — read-only, admin-only dashboard summarizing the
 * demo's agent-to-MCP-tool access, RFC 8693 token exchange, PingOne Authorize
 * policy and the related control-plane concepts, in one place.
 *
 * Most sections fetch live endpoints; what has no live source is badged
 * "Static" or "Illustrative" in place. See the TECH_DEBT.md "Agentic Access
 * Console" entry for what is still hand-maintained.
 */
const TABS = [
  { id: "dashboard", label: "Dashboard", Component: DashboardSection },
  { id: "agents", label: "Agents", Component: AgentsSection },
  { id: "servers", label: "MCP Servers", Component: ServersSection },
  { id: "policies", label: "P1AZ Policies", Component: PoliciesSection },
  { id: "auth", label: "Authentication", Component: AuthSection },
  { id: "tokenExchange", label: "Token Exchange", Component: TokenExchangeSection },
  { id: "aiBroker", label: "AI Broker", Component: AiBrokerSection },
  { id: "ciba", label: "CIBA", Component: CibaSection },
  { id: "verticals", label: "Verticals", Component: VerticalsSection },
];

export default function AgenticAccessConsolePage({ user }) {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [activeTab, setActiveTab] = useState("dashboard");

  const Active = TABS.find((t) => t.id === activeTab)?.Component || DashboardSection;

  return (
    <div className="aac-page">
      <header className="aac-head">
        <button
          type="button"
          onClick={toggleDarkMode}
          className="aac-theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
        </button>
        <p className="aac-eyebrow">🔐 Control plane</p>
        <h1>Agentic Access Console</h1>
        <p className="aac-sub">
          A read-only summary of how the demo's agents reach MCP tools: what each
          agent can call, how PingOne Authorize and RFC 8693 token exchange gate
          every call, and the AI Broker / CIBA / Agentic Apps layers around it.
        </p>
      </header>

      <nav className="aac-tabs" aria-label="Agentic Access Console sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`aac-tab${activeTab === t.id ? " aac-tab--active" : ""}`}
            aria-current={activeTab === t.id ? "page" : undefined}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <section className="aac-section">
        <Active user={user} />
      </section>
    </div>
  );
}
