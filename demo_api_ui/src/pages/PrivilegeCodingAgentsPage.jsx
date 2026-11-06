// /privilege-coding-agents — Coding Agents (Platform Update, page 18).
//
// Inspection inside the agent, before it acts: Claude Code, Cursor, Codex,
// Gemini CLI, Copilot and Antigravity are covered through their own hook
// interfaces, written to machine-level managed configuration. The gateway
// answers in each agent's native allow / deny / ask vocabulary.
//
// Honesty: the hook events, payloads and decisions here are a deterministic
// walkthrough of the documented model — the same gateway, policies and
// detection as LLM and MCP traffic, evaluated at the agent. No live gateway
// call is made from this page.

import { useMemo, useState } from 'react';
import PrivilegeLiveCheck from '../components/privilege/PrivilegeLiveCheck';
import InspectorShell from '../components/shared/InspectorShell';
import InspectorListItem from '../components/shared/InspectorListItem';
import InspectorTabs from '../components/shared/InspectorTabs';
import PageHeader from '../components/common/PageHeader';
import JsonHighlight from '../components/shared/JsonHighlight';
import {
  CODING_AGENTS,
  CODING_HOOK_SCENARIOS,
  CODING_DECISION_META,
} from '../config/privilegePlatformUpdateDemos';
import './PrivilegeCodingAgentsPage.css';

function decisionLabel(id) {
  return CODING_DECISION_META[id]?.label ?? id;
}

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
      audit: { identity: 'from machine certificate', device: 'recorded', gatewayReachable: true },
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
          <span className="pca-field-label">Gateway evaluation</span>
          {scenario.detection ? (
            <p className="pca-detection" data-testid="pca-detection">
              <strong>{scenario.detection.category}</strong> — {scenario.detection.rule}: {scenario.detection.detail}
            </p>
          ) : (
            <p className="pca-detection pca-detection--clean" data-testid="pca-detection">
              No rule fired. The evaluation still ran, under the developer's identity from the machine certificate.
            </p>
          )}
        </div>
        <p className="pca-note">
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
          { key: 'wire', label: 'What the hook returns' },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />
      <div className="inspector-shell-output-body">
        {activeTab === 'decision' && (
          <>
            <div className={`pca-verdict pca-verdict--${scenario.decision}`} data-testid="pca-verdict" role="status">
              <strong>{decisionLabel(scenario.decision)}</strong>
              <p>{decision?.note}</p>
              <p className="pca-reason">{scenario.reason}</p>
            </div>
            <PrivilegeLiveCheck
              tool="get_access_grants"
              args={{ user: 'alice', resource: 'payments-api' }}
              label="See this agent's entitlements through live Privilege"
            />
          </>
        )}
        {activeTab === 'wire' && (
          <pre className="inspector-shell-output-code pca-wire-pre" data-testid="pca-wire">
            <JsonHighlight value={evaluationJson(scenario)} />
          </pre>
        )}
      </div>
    </>
  );

  return (
    <div className="pca-page">
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="Coding Agents"
        summary="Privilege evaluated at the agent itself — prompts, shell commands, MCP calls and tool results, answered in each agent's native allow / deny / ask. One policy, one audit trail."
      />
      <InspectorShell
        title="Hook evaluation"
        statusOn
        statusText="documented-behaviour walkthrough — with a live gateway check under the decision"
        fullHeight={false}
        left={left}
        middle={middle}
        right={right}
      />
    </div>
  );
}
