import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from '../components/pingUi';
import PrivilegeA2aTab from '../features/privilegeA2aClient/PrivilegeA2aTab';
import { usePrivilegeA2aProfile } from '../features/privilegeA2aClient/usePrivilegeA2aProfile';
// The tab imports its own sheet; naming it here as well lets scripts/check-ui-patterns.mjs scan it for this route.
import '../features/privilegeA2aClient/PrivilegeA2aTab.css';

/**
 * Privilege A2A access review as its own page (it was a tab on the MCP client).
 *
 * Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through
 * the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame and
 * sections, P4 cards, P5 key-value list, P7 chips with a word, P9 buttons. P6 (a fixed-height inspector shell)
 * and P8 (diagram boxes) are skipped: the three columns of the old workbench become cards in the frame, and the
 * request path is a plain list. The conversation, trace and gateway record are PrivilegeA2aTab; its primary-button
 * decision per state is written there. This page's own buttons and links are all secondary.
 *
 * The page no longer carries its own light/dark switch (the old workbench shell had one, shared with the MCP
 * client through the cur_priv_theme key): it follows the app's theme, driven from the main top bar.
 */
export default function PrivilegeA2aPage({ user }) {
  const profile = usePrivilegeA2aProfile();
  // The page's own agent column is the agent here, so the global agent button is hidden while this page is open.
  // Its modals (for example the run's sequence view) portal into body and are not affected.
  useEffect(() => {
    document.body.classList.add('privilege-a2a-route');
    return () => document.body.classList.remove('privilege-a2a-route');
  }, []);

  const identity = user?.email || user?.username || user?.name || '';

  return (
    <PingPage className="a2a-page" data-testid="privilege-a2a-page">
      <SimBanner data-testid="a2a-banner">
        <strong>LIVE AGENTS, SAMPLE ACCESS DATA</strong> — a question you send goes from this app&apos;s server to
        the real A2A Client agent, over A2A to the Remote Agent, and on to the MCP tools through the Agent
        Privilege gateway when the agents run in gateway mode. Those hops, the trace and the gateway record are
        real and need the agent processes running. The entitlements, grants and tickets the tools return are
        sample data. Heuristics mode makes no model call; the other mode calls the model. The cost figure is an
        estimate at list price, not a bill.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · A2A"
        title="A2A access review"
        summary="Ask an agent who has access to what. It hands the lookup to a Remote Agent over A2A, and the Remote Agent reads the access data through MCP tools."
      />
      <PageFrame>
        <Section
          id="a2a-who-h"
          kicker="1 · Who is asking"
          title="The caller and the two agents"
          lede="Who is signed in, which vertical is active, and which two agents answer for it."
        >
          <Card title="Who is asking, which agents answer" aria-label="Who is asking and which agents answer">
            <p className="pu-status-line">
              <StatusChip tone={identity ? 'ok' : 'warn'}>{identity ? 'Signed in' : 'Not signed in'}</StatusChip>
            </p>
            <KvList
              items={[
                { label: 'Identity', value: <span data-testid="a2a-identity">{identity || '—'}</span> },
                { label: 'Vertical', value: <span data-testid="a2a-vertical">{profile?.vertical || '—'}</span> },
                { label: 'A2A Client', value: <span data-testid="a2a-main-agent">{profile?.agentName || 'Main agent'}</span> },
                { label: 'Remote Agent', value: <span data-testid="a2a-worker-agent">{profile?.specialistName || 'Analyst'}</span> },
              ]}
            />
            <div className="pu-actions">
              <a className="pu-btn" href="/use-case-diagrams/UC46" target="_blank" rel="noopener noreferrer" title="Privilege A2A access review diagram (opens in a new tab)">Diagram</a>
              <Link className="pu-btn" to="/privilege-mcp-client">MCP client</Link>
            </div>
          </Card>
        </Section>
        <PrivilegeA2aTab />
      </PageFrame>
    </PingPage>
  );
}
