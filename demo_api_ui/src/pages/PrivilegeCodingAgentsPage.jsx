// /privilege-coding-agents — Coding Agents (Platform Update, page 18).
//
// Inspection inside the agent, before it acts: Claude Code, Cursor, Codex,
// Gemini CLI, Copilot and Antigravity are covered through their own hook
// interfaces, written to machine-level managed configuration. The gateway
// answers in each agent's native allow / deny / ask vocabulary.
//
// Honesty: the hook events, payloads and decisions here are a deterministic
// walkthrough of the documented model — the same gateway, policies and
// detection as LLM and MCP traffic, evaluated at the agent. The one real call
// is the live entitlement check in section 2, which goes through this
// machine's BFF to the Privilege AI Gateway (a fictional sample tool).
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md): P2 banner first, P3 frame, P4 cards, P5 kv,
// P7 chips, P9 buttons, on the shared primitives (components/pingUi,
// styles/ping-ui.css). The three-column hook inspector is the shared
// InspectorShell (P6) and stays as it was. The standalone shell bar is not
// added (the app has its own).

import { useMemo, useState } from 'react';
import PrivilegeLiveCheck from '../components/privilege/PrivilegeLiveCheck';
import InspectorShell from '../components/shared/InspectorShell';
import InspectorListItem from '../components/shared/InspectorListItem';
import InspectorTabs from '../components/shared/InspectorTabs';
import PageHeader from '../components/common/PageHeader';
import JsonHighlight from '../components/shared/JsonHighlight';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from '../components/pingUi';
import {
  CODING_AGENTS,
  CODING_HOOK_SCENARIOS,
  CODING_DECISION_META,
} from '../config/privilegePlatformUpdateDemos';
import './PrivilegeCodingAgentsPage.css';

function decisionLabel(id) {
  return CODING_DECISION_META[id]?.label ?? id;
}

const DECISION_TONE = { allow: 'ok', ask: 'warn', deny: 'danger' };

function evaluationJson(scenario) {
  return JSON.stringify(
    {
      event: scenario.event,
      agent: CODING_AGENTS.find((a) => a.id === scenario.agentId)?.name,
      detection: scenario.detection
        ? { category: scenario.detection.category, rule: scenario.detection.rule, detail: scenario.detection.detail }
        : null,
      decision: scenario.decision,
      reason: scenario.reason,
      audit: { identity: 'from machine certificate', device: 'recorded' },
    },
    null,
    2,
  );
}

export default function PrivilegeCodingAgentsPage() {
  const [selectedKey, setSelectedKey] = useState(CODING_HOOK_SCENARIOS[0].key);
  const [activeTab, setActiveTab] = useState('decision');

  const scenario = useMemo(
    () => CODING_HOOK_SCENARIOS.find((s) => s.key === selectedKey) ?? CODING_HOOK_SCENARIOS[0],
    [selectedKey],
  );
  const agent = CODING_AGENTS.find((a) => a.id === scenario.agentId);
  const decision = CODING_DECISION_META[scenario.decision];

  const left = (
    <>
      <div className="inspector-shell-tree-header">Hook evaluations</div>
      <div className="inspector-shell-tree-body">
        {CODING_AGENTS.map((a) => {
          const rows = CODING_HOOK_SCENARIOS.filter((s) => s.agentId === a.id);
          if (!rows.length) return null;
          return (
            <div key={a.id}>
              <div className="inspector-shell-tree-group__label">{a.name}</div>
              {rows.map((s) => (
                <InspectorListItem
                  key={s.key}
                  label={s.detection ? s.detection.rule : 'clean prompt'}
                  active={s.key === selectedKey}
                  dot={s.decision === 'deny' ? 'write' : s.decision === 'ask' ? 'sensitive' : 'default'}
                  onClick={() => setSelectedKey(s.key)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );

  const middle = (
    <>
      <div className="inspector-shell-form-header">
        <span className="inspector-shell-form-header__name">{agent?.name} · {scenario.event}</span>
        <span className="inspector-shell-form-header__desc">
          The hook fires on the agent's own lifecycle event; nothing for a developer to install beyond the
          machine-level managed configuration.
        </span>
      </div>
      <div className="inspector-shell-form-body">
        <div className="pca-field">
          <span className="pca-field-label">What the agent was about to do</span>
          <pre className="pca-payload" data-testid="pca-payload">{scenario.payload}</pre>
        </div>
        <div className="pca-field">
          <span className="pca-field-label">Modelled evaluation</span>
          {scenario.detection ? (
            <p className="pu-status-line" data-testid="pca-detection">
              <StatusChip tone="info">Modelled: rule fired</StatusChip>
              <span>
                <strong>{scenario.detection.category}</strong> — {scenario.detection.rule}: {scenario.detection.detail}
              </span>
            </p>
          ) : (
            <p className="pu-status-line" data-testid="pca-detection">
              <StatusChip tone="info">Modelled: no rule fired</StatusChip>
              <span>In the documented model the evaluation still runs, under the developer's identity from the machine certificate. Nothing was evaluated here.</span>
            </p>
          )}
        </div>
        <p className="pu-note">
          Developers keep working if the gateway is briefly unreachable — the gap is recorded for review. A
          regulated environment can require a refusal instead, set per tenant.
        </p>
      </div>
    </>
  );

  const right = (
    <>
      <InspectorTabs
        tabs={[
          { key: 'decision', label: 'Decision' },
          { key: 'wire', label: 'Modelled response' },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />
      <div className="inspector-shell-output-body">
        {activeTab === 'decision' && (
          <DecisionCard scenario={scenario} agent={agent} decision={decision} />
        )}
        {activeTab === 'wire' && (
          <>
            <p className="pu-note" data-testid="pca-wire-note">
              Modelled response: what the documented hook returns for this scenario. It was not produced by a
              gateway call, and no reachability was checked.
            </p>
            <pre className="inspector-shell-output-code pca-wire-pre" data-testid="pca-wire">
              <JsonHighlight value={evaluationJson(scenario)} />
            </pre>
          </>
        )}
      </div>
    </>
  );

  return (
    <PingPage className="pca-page">
      <SimBanner data-testid="pca-banner">
        <strong>SIMULATED WALKTHROUGH</strong> — the hook events, payloads and allow / ask / deny decisions on
        this page are a deterministic walkthrough of the documented model. No coding agent hook is installed
        or evaluated on this machine. The one live call is the gateway check at the bottom: it goes
        through this machine's BFF to the Privilege AI Gateway, but the tool it calls is a fictional sample.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="Coding Agents"
        summary="Privilege evaluated at the agent itself — prompts, shell commands, MCP calls and tool results, answered in each agent's native allow / deny / ask. One policy, one audit trail."
      />
      <PageFrame>
        <Section
          id="pca-eval"
          kicker="1 · Hook evaluation"
          title="What the hook sees and what it returns"
          lede="Pick an evaluation on the left: the payload the agent was about to act on, the rule that fired, and the decision in the agent's own vocabulary."
        >
          <InspectorShell
            title="Hook evaluation"
            statusOn
            statusText="documented-behaviour walkthrough — with a live gateway check below"
            fullHeight={false}
            titleLevel={2}
            left={left}
            middle={middle}
            right={right}
          />
        </Section>

        <Section id="pca-live" kicker="2 · Live check" title="Call a tool through the gateway (sample data)">
          <Card tone="live">
            <p className="pu-status-line">
              <StatusChip tone="info">Live call</StatusChip>
              The allow or deny decision below comes from the gateway. The tool behind it is a fictional sample, so any record it returns is made-up data.
            </p>
            <PrivilegeLiveCheck
              tool="get_access_grants"
              args={{ user: 'alice', resource: 'payments-api' }}
              label="Call a sample tool through the gateway"
              buttonClassName="pu-btn pu-btn--primary"
              statusChip
            />
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// Below the page so the page reads banner first in source order; function declarations hoist.
function DecisionCard({ scenario, agent, decision }) {
  const tone = DECISION_TONE[scenario.decision] ?? 'neutral';
  return (
    <Card tone={tone} title="Simulated decision" className="pca-verdict" role="status" data-testid="pca-verdict">
      <p className="pu-status-line">
        <StatusChip tone={tone}>{decisionLabel(scenario.decision)}</StatusChip>
        {decision?.note}
      </p>
      <KvList
        items={[
          { label: 'Agent', value: agent?.name },
          { label: 'Hook event', value: scenario.event, mono: true },
          { label: 'Rule', value: scenario.detection ? scenario.detection.rule : 'none fired' },
        ]}
      />
      <p className="pu-note">{scenario.reason}</p>
    </Card>
  );
}
