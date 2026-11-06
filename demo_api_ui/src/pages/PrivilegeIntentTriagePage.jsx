// /privilege-intent-triage — Intent, Purpose and Behaviour (Platform Update, page 17).
//
// A Privilege demo: three questions asked of every call, and only one of them
// is about the request itself. The page walks each scenario through the three
// signals and shows which tier the outcome comes from.
//
// Honesty: the signals and outcomes here are a deterministic restatement of the
// platform's documented model (deterministic tier refuses; scored signals drive
// alerts and approval), not a live gateway call. The live counterpart — what
// PingOne Authorize actually decided about an intent grant — is the Intent
// Inspector (/intent-inspector), which fires at a real decision endpoint.

import { useMemo, useState } from 'react';
import PrivilegeLiveCheck from '../components/privilege/PrivilegeLiveCheck';
import { Link } from 'react-router-dom';
import InspectorShell from '../components/shared/InspectorShell';
import InspectorListItem from '../components/shared/InspectorListItem';
import InspectorTabs from '../components/shared/InspectorTabs';
import PageHeader from '../components/common/PageHeader';
import {
  INTENT_TRIAGE_SCENARIOS,
  TRIAGE_SCENARIO_CATEGORIES,
  TRIAGE_SIGNAL_META,
} from '../config/privilegePlatformUpdateDemos';
import './PrivilegeIntentTriagePage.css';

const OUTCOME_META = {
  deny: { label: 'Deny', cls: 'triage-outcome--deny', note: 'Hard refusal from the deterministic tier. No scored signal, approval, or further rule can lift it.' },
  hold: { label: 'Hold for approval', cls: 'triage-outcome--hold', note: 'A person decides. The request is refused with a reason, a reference and an expiry; the agent retries after approval.' },
  alert: { label: 'Alert (outcome unchanged)', cls: 'triage-outcome--alert', note: 'Recorded without changing the result — the watch-only rollout path.' },
  allow: { label: 'Allow', cls: 'triage-outcome--allow', note: 'No rule fired and no scored signal crossed its threshold.' },
};

function SignalCard({ meta, signal }) {
  const deterministic = Boolean(signal.deterministic);
  return (
    <div className={`triage-signal ${deterministic ? 'triage-signal--deterministic' : ''}`} data-testid={`triage-signal-${meta.id}`}>
      <div className="triage-signal-head">
        <h3>{meta.title}</h3>
        <span className="triage-signal-tier">{deterministic ? 'deterministic' : 'scored'}</span>
      </div>
      <p className="triage-signal-q">{meta.question}</p>
      <dl>
        {meta.id === 'intent' && (
          <>
            <div><dt>Classification</dt><dd>{signal.classification}</dd></div>
            <div><dt>Rule</dt><dd>{signal.rule}</dd></div>
          </>
        )}
        {meta.id === 'purpose' && (
          <>
            <div><dt>Declared purpose</dt><dd>{signal.declared}</dd></div>
            <div><dt>In scope</dt><dd>{signal.inScope ? 'yes' : 'no'}</dd></div>
            <div><dt>Note</dt><dd>{signal.note}</dd></div>
          </>
        )}
        {meta.id === 'behaviour' && (
          <>
            <div><dt>Baseline</dt><dd>{signal.baseline}</dd></div>
            <div><dt>Departure</dt><dd>{signal.departure}</dd></div>
            <div><dt>Note</dt><dd>{signal.note}</dd></div>
          </>
        )}
      </dl>
    </div>
  );
}

export default function PrivilegeIntentTriagePage() {
  const [selectedKey, setSelectedKey] = useState(INTENT_TRIAGE_SCENARIOS[0].key);
  const [activeTab, setActiveTab] = useState('signals');

  const scenario = useMemo(
    () => INTENT_TRIAGE_SCENARIOS.find((s) => s.key === selectedKey) ?? INTENT_TRIAGE_SCENARIOS[0],
    [selectedKey],
  );
  const outcome = OUTCOME_META[scenario.outcome];

  const left = (
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
        <span className="inspector-shell-form-header__name">{scenario.title}</span>
        <span className="inspector-shell-form-header__desc">{scenario.story}</span>
      </div>
      <div className="inspector-shell-form-body">
        <p className="triage-why">
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

  const right = (
    <>
      <InspectorTabs
        tabs={[
          { key: 'signals', label: 'Verdict' },
          { key: 'tier', label: 'Which tier' },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />
      <div className="inspector-shell-output-body">
        {activeTab === 'signals' && (
          <>
            <div className={`triage-outcome ${outcome.cls}`} data-testid="triage-verdict" role="status">
              <strong>{outcome.label}</strong>
              <p>{outcome.note}</p>
              <p className="triage-expect">{scenario.expect}</p>
            </div>
            <PrivilegeLiveCheck
              tool="list_entitlements"
              args={{ user: 'alice' }}
              label="Check the same subject through live Privilege"
            />
          </>
        )}
        {activeTab === 'tier' && (
          <div className="triage-tier">
            <p>
              A model’s judgement never silently becomes the enforcement decision. The deterministic tier
              (pattern rules like shell metacharacters, bulk-export-after-read, missing purpose declaration)
              refuses outright. Everything scored — intent similarity, behavioural anomaly — can only alert or
              ask for a person.
            </p>
            <p>
              The live version of this flow — a real PingOne Authorize decision against a real intent grant —
              is the <Link to="/intent-inspector">Intent Inspector</Link>.
            </p>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="triage-page">
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="Intent, Purpose and Behaviour"
        summary="Three questions asked of every call: what it attempts, whether the agent was issued for it, and whether it normally does it. Deliberately three signals, not one score."
      />
      <InspectorShell
        title="Agent call triage"
        statusOn
        statusText="documented-behaviour model — with a live gateway check below the verdict"
        fullHeight={false}
        left={left}
        middle={middle}
        right={right}
      />
    </div>
  );
}
