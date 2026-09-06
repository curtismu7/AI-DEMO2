// demo_api_ui/src/pages/LlmGatewayCombinedPage.jsx
//
// Wraps the two Privilege LLM gateway pages under one page with a tab strip,
// so /llm-gateway and /llm-test are one destination instead of two nav entries
// to the same subject.
//
// Deliberately a thin switcher, not a merge of the two components' internals.
// LlmGatewayPage (the chat console, which classifies a call's outcome) and
// LlmTestPage (the raw REST client, which interprets nothing — see its own
// header comment for why that separation matters) each already fetch their
// own /llm/config and manage their own state, and each has a test suite
// pinning that behaviour. Lifting the shared state into this wrapper would
// touch both, for no benefit a demo audience would notice, and would be a much
// larger diff to get wrong. Only one tab is mounted at a time, so there is no
// double-polling and no duplicate DOM ids while a tab is inactive.
import { useState } from 'react';
import LlmGatewayPage from './LlmGatewayPage';
import LlmTestPage from './LlmTestPage';
import './LlmGatewayCombinedPage.css';

const TABS = [
  { key: 'chat', label: 'Chat console' },
  { key: 'raw', label: 'Raw request' },
];

export default function LlmGatewayCombinedPage({ defaultTab = 'chat' }) {
  const [tab, setTab] = useState(defaultTab);

  return (
    <div className="lgwc">
      <nav className="lgwc-tabs" role="tablist" aria-label="LLM Gateway view">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`lgwc-tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'chat' ? <LlmGatewayPage /> : <LlmTestPage />}
    </div>
  );
}
