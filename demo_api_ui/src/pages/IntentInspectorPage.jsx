// demo_api_ui/src/pages/IntentInspectorPage.jsx
//
// The Intent Inspector. Its subject is the INTENT GRANT: what the user actually
// consented to, what the agent is attempting now, and what PingOne Authorize
// decided about the difference.
//
// Sibling to the LLM Gateway console, which asks "what may this key do?" about a
// prompt. This asks "did the user agree to THIS action?" about a tool call, and
// answers it from the "PingOne Authorize — Agent Intent Governance" policy set
// (snapshots/PingOne_Authorize_Agent_Intent_Governance.snapshot.json).
//
// Honesty rules for this screen, in order of how easily each could be violated:
//
//  1. The VERDICT is PingOne Authorize's, never this page's. The Comparison tab
//     re-states what the policy conditions do so a reader can see which pair
//     disagreed — it is labelled a local view and it never overrides the
//     decision. When the local view and the verdict disagree, BOTH are shown:
//     that disagreement is a finding about the deployed policy, not a rendering
//     bug to smooth over.
//  2. A decision endpoint not backed by the Agent Intent Governance policy set
//     will answer, and its answer is not a drift verdict. The page warns when the
//     returned statements contain no intent-* code rather than presenting an
//     unrelated PERMIT as if intent had been evaluated.
//  3. The expectation shown per scenario is what the policy SHOULD return. It is
//     never used to colour the verdict.
import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../services/apiClient';
import InspectorShell from '../components/shared/InspectorShell';
import InspectorListItem from '../components/shared/InspectorListItem';
import InspectorTabs from '../components/shared/InspectorTabs';
import JsonHighlight from '../components/shared/JsonHighlight';
import {
  INTENT_DRIFT_SCENARIOS,
  INTENT_SCENARIO_CATEGORIES,
  INTENT_COMPARISONS,
  INTENT_PRECONDITIONS,
  INTENT_PARAM_FIELDS,
} from '../config/intentDriftScenarios';

const TABS = [
  { key: 'decision', label: 'Decision' },
  { key: 'comparison', label: 'Comparison' },
  { key: 'response', label: 'Response' },
  { key: 'request', label: 'Request' },
];

/** Statement codes this policy set emits. Used only to tell "intent was evaluated"
 *  from "some other policy answered", never to derive a verdict. */
const INTENT_CODE_RE = /^intent-/;

function statementsOf(result) {
  const raw = result?.raw ?? {};
  const list = raw.statements ?? raw.details?.statements ?? [];
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

function codesOf(result) {
  return statementsOf(result).map((s) => s.code).filter(Boolean);
}

/**
 * Local restatement of the policy's comparisons, for display.
 * Returns one row per dimension with the grant value, the request value, and
 * whether that pair violates its rule. Never consulted for the verdict.
 */
function compareLocally(params) {
  const governed = params.IntentGrantPresent === 'true' && params.IntentRequestMutating === 'true';
  return INTENT_COMPARISONS.map((c) => {
    const grant = params[c.grantKey] ?? '';
    const request = params[c.requestKey] ?? '';
    let violates = false;
    if (governed) {
      violates = c.numeric
        ? Number(request || 0) > Number(grant || 0)
        : String(request) !== String(grant);
    }
    return { ...c, grant, request, violates, governed };
  });
}

export default function IntentInspectorPage() {
  const [selectedKey, setSelectedKey] = useState(INTENT_DRIFT_SCENARIOS[0].key);
  const [params, setParams] = useState(() => ({ ...INTENT_DRIFT_SCENARIOS[0].parameters }));
  const [endpoints, setEndpoints] = useState([]);
  const [endpointId, setEndpointId] = useState('');
  const [endpointsError, setEndpointsError] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('decision');
  const [elapsedMs, setElapsedMs] = useState(null);

  const scenario = useMemo(
    () => INTENT_DRIFT_SCENARIOS.find((s) => s.key === selectedKey) ?? INTENT_DRIFT_SCENARIOS[0],
    [selectedKey],
  );

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/api/authorize/decision-endpoints')
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.endpoints ?? [];
        setEndpoints(list);
        // No default guess: firing at the wrong endpoint returns a confident
        // verdict about a different policy. The operator picks.
        setEndpointsError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setEndpointsError(
          err?.response?.data?.message
            || err?.response?.data?.error
            || 'Could not list decision endpoints (admin session required).',
        );
      });
    return () => { cancelled = true; };
  }, []);

  const selectScenario = useCallback((key) => {
    const next = INTENT_DRIFT_SCENARIOS.find((s) => s.key === key);
    if (!next) return;
    setSelectedKey(key);
    setParams({ ...next.parameters });
    setResult(null);
    setError('');
    setElapsedMs(null);
  }, []);

  const setParam = useCallback((key, value) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const evaluate = useCallback(async () => {
    if (!endpointId) {
      setError('Choose the decision endpoint backed by the Agent Intent Governance policy set.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    const started = Date.now();
    try {
      const res = await apiClient.post('/api/authorize/evaluate-endpoint', {
        endpointId,
        parameters: params,
        useCaseId: 'intent-inspector',
      });
      setResult(res.data);
      setActiveTab('decision');
    } catch (err) {
      setError(
        err?.response?.data?.message
          || err?.response?.data?.error
          || err.message
          || 'Evaluation failed.',
      );
    } finally {
      setElapsedMs(Date.now() - started);
      setLoading(false);
    }
  }, [endpointId, params]);

  const codes = result ? codesOf(result) : [];
  const intentEvaluated = codes.some((c) => INTENT_CODE_RE.test(c));
  const comparisons = compareLocally(params);
  const localExpectsDeny = comparisons.some((c) => c.violates);

  // ---------------------------------------------------------------- left
  const left = (
    <>
      <div className="inspector-shell-tree-header">Intent scenarios</div>
      <div className="inspector-shell-tree-body">
        {INTENT_SCENARIO_CATEGORIES.map((cat) => {
          const rows = INTENT_DRIFT_SCENARIOS.filter((s) => s.category === cat);
          if (!rows.length) return null;
          return (
            <div key={cat}>
              <div className="inspector-shell-tree-group__label">{cat}</div>
              {rows.map((s) => (
                <InspectorListItem
                  key={s.key}
                  label={s.label}
                  active={s.key === selectedKey}
                  dot={s.expect.decision === 'DENY' ? 'write' : 'default'}
                  onClick={() => selectScenario(s.key)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );

  // -------------------------------------------------------------- middle
  const field = (f) => {
    const value = params[f.key] ?? '';
    return (
      <div className="inspector-shell-field" key={f.key}>
        <label htmlFor={`intent-${f.key}`}>
          {f.label} <span className="type">{f.key}</span>
        </label>
        {f.type === 'boolean' ? (
          <select
            id={`intent-${f.key}`}
            value={value === '' ? '' : String(value)}
            onChange={(e) => setParam(f.key, e.target.value)}
          >
            <option value="">(omitted — policy default applies)</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            id={`intent-${f.key}`}
            type={f.type === 'number' ? 'number' : 'text'}
            value={value}
            onChange={(e) => setParam(f.key, e.target.value)}
          />
        )}
      </div>
    );
  };

  const middle = (
    <>
      <div className="inspector-shell-form-header">
        <div className="inspector-shell-form-header__name">{scenario.label}</div>
        <div className="inspector-shell-form-header__desc">{scenario.description}</div>
      </div>
      <div className="inspector-shell-form-body">
        <div className="inspector-shell-field">
          <label htmlFor="intent-endpoint">
            Decision endpoint <span className="req">*</span>
          </label>
          <select
            id="intent-endpoint"
            value={endpointId}
            onChange={(e) => setEndpointId(e.target.value)}
          >
            <option value="">Select a decision endpoint…</option>
            {endpoints.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.name || ep.id}</option>
            ))}
          </select>
        </div>
        {endpointsError && <div className="inspector-shell-form-error">{endpointsError}</div>}

        <div className="inspector-shell-tree-group__label">Consented grant</div>
        {INTENT_PARAM_FIELDS.filter((f) => f.group === 'grant').map(field)}

        <div className="inspector-shell-tree-group__label">Proposed action</div>
        {INTENT_PARAM_FIELDS.filter((f) => f.group === 'request').map(field)}

        <div className="inspector-shell-form-actions">
          <button className="inspector-shell-btn-call" onClick={evaluate} disabled={loading}>
            {loading ? 'Evaluating…' : 'Evaluate'}
          </button>
          <button className="inspector-shell-btn-clear" onClick={() => selectScenario(selectedKey)}>
            Reset
          </button>
        </div>
        {error && <div className="inspector-shell-form-error">{error}</div>}
      </div>
    </>
  );

  // --------------------------------------------------------------- right
  const decisionTab = !result ? (
    <div className="inspector-shell-output-empty">
      Select a scenario and an endpoint, then Evaluate to see the PingOne
      Authorize verdict.
    </div>
  ) : (
    <div>
      <p>
        <strong>PingOne Authorize decision:</strong> {result.decision}
      </p>
      <p>
        <strong>Statements:</strong> {codes.length ? codes.join(', ') : '—'}
      </p>
      <p>
        <strong>Expected for this scenario:</strong> {scenario.expect.decision}
        {' / '}
        {scenario.expect.statement}
      </p>
      {!intentEvaluated && (
        <p>
          ⚠ No <code>intent-*</code> statement came back, so this endpoint is not
          backed by the Agent Intent Governance policy set. The verdict above is
          that endpoint&apos;s own answer about a different policy — it is not an
          intent decision.
        </p>
      )}
      {intentEvaluated && result.decision !== scenario.expect.decision && (
        <p>
          ⚠ The deployed policy disagrees with this scenario&apos;s expectation
          (expected {scenario.expect.decision}, got {result.decision}). Both are
          shown rather than reconciled — check the imported policy set version.
        </p>
      )}
    </div>
  );

  const comparisonTab = (
    <div>
      <p>
        Local view of the comparisons the policy performs. This does not decide
        anything — the verdict is on the Decision tab.
      </p>
      <table>
        <thead>
          <tr><th>Dimension</th><th>Consented</th><th>Attempted</th><th>Rule</th></tr>
        </thead>
        <tbody>
          {comparisons.map((c) => (
            <tr key={c.label}>
              <td>{c.label}</td>
              <td>{c.grant || '—'}</td>
              <td>{c.request || '—'}</td>
              <td>{c.violates ? `❌ ${c.rule}` : `✓ ${c.rule}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Grant integrity</p>
      <table>
        <thead>
          <tr><th>Fact</th><th>Value</th><th>Rule</th></tr>
        </thead>
        <tbody>
          {INTENT_PRECONDITIONS.map((p) => {
            const v = params[p.key] ?? '';
            const bad = p.good !== null && v !== '' && v !== p.good;
            return (
              <tr key={p.key}>
                <td>{p.label}</td>
                <td>{v === '' ? '(omitted)' : v}</td>
                <td>{bad ? `❌ ${p.rule}` : p.rule}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {result && intentEvaluated && localExpectsDeny !== (result.decision === 'DENY') && (
        <p>
          ⚠ This local view and PingOne Authorize disagree. The verdict stands;
          the difference is a finding about the deployed policy.
        </p>
      )}
    </div>
  );

  const right = (
    <>
      <InspectorTabs tabs={TABS} activeKey={activeTab} onChange={setActiveTab} />
      <div className="inspector-shell-output-body">
        {activeTab === 'decision' && decisionTab}
        {activeTab === 'comparison' && comparisonTab}
        {activeTab === 'response' && (
          <pre className="inspector-shell-output-code">
            <JsonHighlight value={result?.raw ?? result} deep copyable />
          </pre>
        )}
        {activeTab === 'request' && (
          <pre className="inspector-shell-output-code">
            <JsonHighlight value={{ endpointId, parameters: params }} deep copyable />
          </pre>
        )}
      </div>
      <div className="inspector-shell-output-footer">
        <span>Status: {result ? result.decision : '—'}</span>
        <span>Duration: {elapsedMs == null ? '—' : `${elapsedMs} ms`}</span>
        <span>Engine: {result?.engine ?? '—'}</span>
      </div>
    </>
  );

  return (
    <InspectorShell
      title="Intent Inspector"
      statusOn={Boolean(endpointId)}
      statusText={endpointId ? 'Endpoint selected' : 'No endpoint selected'}
      left={left}
      middle={middle}
      right={right}
    />
  );
}
