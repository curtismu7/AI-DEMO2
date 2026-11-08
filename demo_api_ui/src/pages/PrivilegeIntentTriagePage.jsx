// /privilege-intent-triage — Intent, Purpose and Behaviour (Platform Update, page 17).
//
// A Privilege demo: three questions asked of every call, and only one of them
// is about the request itself. The page walks each scenario through the three
// signals and shows which tier the outcome comes from.
//
// Honesty: the signals and outcomes here are a deterministic restatement of the
// platform's documented model (deterministic tier refuses; scored signals drive
// alerts and approval), not a live gateway call. The one real call is the live
// check under the verdict. The live counterpart — what PingOne Authorize
// actually decided about an intent grant — is the Intent Inspector
// (/intent-inspector), which fires at a real decision endpoint.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md): P2 banner first, P3 frame, P4 cards, P5 kv,
// P6 inspector (the shared InspectorShell), P7 chips, P9 buttons. The pattern
// primitives are shared (components/pingUi, styles/ping-ui.css,
// docs/ping-ui-primitives.md). The standalone shell bar is not added (the app
// has its own).

import { useMemo, useState } from 'react';
import PrivilegeLiveCheck from '../components/privilege/PrivilegeLiveCheck';
import { Link } from 'react-router-dom';
import InspectorShell from '../components/shared/InspectorShell';
import InspectorListItem from '../components/shared/InspectorListItem';
import InspectorTabs from '../components/shared/InspectorTabs';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from '../components/pingUi';
import {
  INTENT_TRIAGE_SCENARIOS,
  TRIAGE_SCENARIO_CATEGORIES,
  TRIAGE_SIGNAL_META,
} from '../config/privilegePlatformUpdateDemos';
import './PrivilegeIntentTriagePage.css';

// cardTone: Card has no info edge (an unknown tone would fall back to the vertical accent), so the
// alert outcome carries the neutral edge and its chip says the rest.
const OUTCOME_META = {
  deny: { label: 'Deny', chip: 'Refused', tone: 'danger', cardTone: 'danger', note: 'Hard refusal from the deterministic tier. No scored signal, approval, or further rule can lift it.' },
  hold: { label: 'Hold for approval', chip: 'Pending approval', tone: 'warn', cardTone: 'warn', note: 'A person decides. The request is refused with a reason, a reference and an expiry; the agent retries after approval.' },
  alert: { label: 'Alert (outcome unchanged)', chip: 'Recorded', tone: 'info', cardTone: 'neutral', note: 'Recorded without changing the result — the watch-only rollout path.' },
  allow: { label: 'Allow', chip: 'Allowed', tone: 'ok', cardTone: 'ok', note: 'No rule fired and no scored signal crossed its threshold.' },
};

export default function PrivilegeIntentTriagePage() {
  const [selectedKey, setSelectedKey] = useState(INTENT_TRIAGE_SCENARIOS[0].key);
  const [activeTab, setActiveTab] = useState('signals');

  const scenario = useMemo(
    () => INTENT_TRIAGE_SCENARIOS.find((s) => s.key === selectedKey) ?? INTENT_TRIAGE_SCENARIOS[0],
    [selectedKey],
  );

  return (
    <PingPage className="triage-page">
      <SimBanner data-testid="triage-banner">
        <strong>DOCUMENTED-BEHAVIOUR MODEL</strong> — the three signals and the verdict for each scenario are a
        fixed restatement of how the platform is documented to behave, not a decision made on this machine.
        Nothing is scored or refused here. The one real call is the live check under the verdict: it goes
        through this machine's BFF to the Privilege AI Gateway.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="Intent, Purpose and Behaviour"
        summary="Three questions asked of every call: what it attempts, whether the agent was issued for it, and whether it normally does it. Deliberately three signals, not one score."
      />
      <PageFrame>
        <Section
          id="triage-walk"
          kicker="1 · Walk a call through the signals"
          title="Intent says what, purpose says whether, behaviour says how it usually looks"
        >
          <InspectorShell
            title="Agent call triage"
            statusOn
            statusText="documented-behaviour model — with a live gateway check below the verdict"
            fullHeight={false}
            left={<ScenarioTree selectedKey={selectedKey} onSelect={setSelectedKey} />}
            middle={<ScenarioSignals scenario={scenario} />}
            right={<ScenarioVerdict scenario={scenario} activeTab={activeTab} onTab={setActiveTab} />}
          />
        </Section>
      </PageFrame>
    </PingPage>
  );
}

function ScenarioTree({ selectedKey, onSelect }) {
  return (
    <>
      <div className="inspector-shell-tree-header">Call scenarios</div>
      <div className="inspector-shell-tree-body">
        {TRIAGE_SCENARIO_CATEGORIES.map((cat) => {
          const rows = INTENT_TRIAGE_SCENARIOS.filter((s) => s.category === cat);
          if (!rows.length) return null;
          return (
            <div key={cat}>
              <div className="inspector-shell-tree-group__label">{cat}</div>
              {rows.map((s) => (
                <InspectorListItem
                  key={s.key}
                  label={s.title}
                  active={s.key === selectedKey}
                  onClick={() => onSelect(s.key)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ScenarioSignals({ scenario }) {
  return (
    <>
      <div className="inspector-shell-form-header">
        <span className="inspector-shell-form-header__name">{scenario.title}</span>
        <span className="inspector-shell-form-header__desc">{scenario.story}</span>
      </div>
      <div className="inspector-shell-form-body">
        <p className="pu-note pu-empty">
          Why three signals and not one score: intent says what is being attempted, purpose says whether it was
          ever in scope, behaviour says whether this agent does this. Hard refusals rest on the deterministic
          tier; the scored signals drive alerts and human-in-the-loop approval.
        </p>
        {TRIAGE_SIGNAL_META.map((meta) => (
          <SignalCard key={meta.id} meta={meta} signal={scenario.signals[meta.id]} />
        ))}
      </div>
    </>
  );
}

function ScenarioVerdict({ scenario, activeTab, onTab }) {
  const outcome = OUTCOME_META[scenario.outcome];
  return (
    <>
      <InspectorTabs
        tabs={[
          { key: 'signals', label: 'Verdict' },
          { key: 'tier', label: 'Which tier' },
        ]}
        activeKey={activeTab}
        onChange={onTab}
      />
      <div className="inspector-shell-output-body">
        {activeTab === 'signals' && (
          <>
            <Card tone={outcome.cardTone} title={outcome.label} data-testid="triage-verdict" role="status">
              <p className="pu-status-line"><StatusChip tone={outcome.tone}>{outcome.chip}</StatusChip> Documented-behaviour model, not a gateway call</p>
              <p className="pu-note">{outcome.note}</p>
              <p className="pu-note triage-expect">{scenario.expect}</p>
            </Card>
            <Card tone="live" title="Live check">
              <p className="pu-status-line"><StatusChip tone="info">Live call</StatusChip> Not simulated: the verdict below comes from the gateway.</p>
              <PrivilegeLiveCheck
                tool="list_entitlements"
                args={{ user: 'alice' }}
                label="Check the same subject through live Privilege"
                buttonClassName="pu-btn pu-btn--primary"
                statusChip
              />
            </Card>
          </>
        )}
        {activeTab === 'tier' && (
          <Card tone="neutral" title="Which tier decides">
            <p className="pu-note">
              A model’s judgement never silently becomes the enforcement decision. The deterministic tier
              (pattern rules like shell metacharacters, bulk-export-after-read, missing purpose declaration)
              refuses outright. Everything scored — intent similarity, behavioural anomaly — can only alert or
              ask for a person.
            </p>
            <p className="pu-note">
              The live version of this flow — a real PingOne Authorize decision against a real intent grant —
              is the <Link to="/intent-inspector">Intent Inspector</Link>.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}

function signalItems(meta, signal) {
  if (meta.id === 'intent') {
    return [
      { label: 'Classification', value: signal.classification },
      { label: 'Rule', value: signal.rule },
    ];
  }
  if (meta.id === 'purpose') {
    return [
      { label: 'Declared purpose', value: signal.declared },
      { label: 'In scope', value: signal.inScope ? 'yes' : 'no' },
      { label: 'Note', value: signal.note },
    ];
  }
  return [
    { label: 'Baseline', value: signal.baseline },
    { label: 'Departure', value: signal.departure },
    { label: 'Note', value: signal.note },
  ];
}

function SignalCard({ meta, signal }) {
  const deterministic = Boolean(signal.deterministic);
  return (
    <Card tone={deterministic ? 'danger' : 'neutral'} data-testid={`triage-signal-${meta.id}`}>
      <div className="triage-signal-head">
        <h3 className="pu-h3">{meta.title}</h3>
        <StatusChip tone={deterministic ? 'danger' : 'neutral'}>{deterministic ? 'Deterministic' : 'Scored'}</StatusChip>
      </div>
      <p className="pu-note">{meta.question}</p>
      <KvList items={signalItems(meta, signal)} />
    </Card>
  );
}

