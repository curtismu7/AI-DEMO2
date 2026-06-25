# Authorize Rules Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an `AuthorizeRulesPanel` component that lets users browse active authorization rules and test them against the running policy engine, mirroring the MCP tools panel pattern.

**Architecture:** A new `AuthorizeRulesPanel.jsx` component with a two-column layout (rule list left, rule detail + test form right) reads config from `GET /api/admin/authorize/config` and engine status from `GET /api/authorize/evaluation-status` on mount, then fires `POST /api/authorize/test-evaluate` on demand. The component is placed on the user dashboard (feature-flagged) and in the admin `/configure → Authorize` tab (always visible). No new BFF routes are needed.

**Tech Stack:** React (JSX, hooks), bffAxios, existing BFF endpoints, CSS (inline styles matching app light theme — white background, black/colored text)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_ui/src/components/AuthorizeRulesPanel.jsx` | Create | The panel component — rule list, detail, test form, engine note |
| `demo_api_server/services/configStore.js` | Modify | Add `ff_authorize_rules_panel` to FIELD_DEFS |
| `demo_api_ui/src/components/UserDashboard.js` | Modify | Fetch flag + conditionally render panel below banking content |
| `demo_api_ui/src/components/Configuration/UnifiedConfigurationPage.tsx` | Modify | Render panel above `AuthorizeConfigPage` in the `authorize-rules` section |

---

## Task 1: Add feature flag to configStore

**Files:**
- Modify: `demo_api_server/services/configStore.js`

- [ ] **Step 1: Find the feature flags section in FIELD_DEFS**

Open `demo_api_server/services/configStore.js`. Find the block starting around line 154 that contains entries like:

```javascript
ff_authorize_fail_open:  { public: true, default: 'false' },
ff_authorize_deposits:   { public: true, default: 'false' },
ff_authorize_simulated:  { public: true, default: 'true'  },
ff_hitl_enabled:         { public: true, default: 'true'  },
```

- [ ] **Step 2: Add the new flag**

Add `ff_authorize_rules_panel` immediately after `ff_authorize_simulated`:

```javascript
ff_authorize_simulated:      { public: true, default: 'true'  },
ff_authorize_rules_panel:    { public: true, default: 'false' },
```

- [ ] **Step 3: Verify no build errors**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
node -e "require('./services/configStore')" && echo "OK"
```

Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_server/services/configStore.js
git commit -m "feat(configStore): add ff_authorize_rules_panel feature flag"
```

---

## Task 2: Create AuthorizeRulesPanel component

**Files:**
- Create: `demo_api_ui/src/components/AuthorizeRulesPanel.jsx`

This is the main component. It has three logical sections: data fetching, rule list (left column), and rule detail + test form (right column).

- [ ] **Step 1: Create the file with data fetching and rule-building logic**

Create `demo_api_ui/src/components/AuthorizeRulesPanel.jsx`:

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import bffAxios from '../services/bffAxios';

// ---------------------------------------------------------------------------
// Badge config
// ---------------------------------------------------------------------------
const BADGE_STYLES = {
  CONSENT:  { background: '#dcfce7', color: '#166534' },
  'STEP-UP': { background: '#fef9c3', color: '#854d0e' },
  DENY:     { background: '#fee2e2', color: '#991b1b' },
  GATE:     { background: '#dbeafe', color: '#1e40af' },
  HITL:     { background: '#f3e8ff', color: '#6b21a8' },
  PERMIT:   { background: '#dcfce7', color: '#166534' },
};

function Badge({ type }) {
  const style = BADGE_STYLES[type] || { background: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      display: 'inline-block',
      fontSize: '10px',
      fontWeight: 600,
      padding: '2px 7px',
      borderRadius: '10px',
      ...style,
    }}>
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Build rule list from config response
// ---------------------------------------------------------------------------
function buildRules(config, evalStatus) {
  const sim = config?.simulated || {};
  const flags = config?.flags || {};
  const txRules = [];
  const mcpRules = [];

  txRules.push({
    id: 'confirm',
    name: 'Confirm threshold',
    desc: `Transactions at or above $${sim.confirmAmount ?? 250} require the user to provide explicit consent before proceeding.`,
    badge: 'CONSENT',
    chips: {
      outcome: 'CONSENT',
      value: `$${sim.confirmAmount ?? 250}`,
      scope: 'All types',
    },
    testType: 'transaction',
  });

  txRules.push({
    id: 'stepup',
    name: 'Step-up threshold',
    desc: `Transactions at or above $${sim.stepUpAmount ?? 500} require the user to complete MFA (step-up authentication) before proceeding.`,
    badge: 'STEP-UP',
    chips: {
      outcome: 'STEP-UP',
      value: `$${sim.stepUpAmount ?? 500}`,
      scope: 'All types',
    },
    testType: 'transaction',
  });

  txRules.push({
    id: 'deny',
    name: 'Deny threshold',
    desc: `Transactions above $${sim.denyAmount ?? 2000} are hard-denied — no override or step-up will permit them.`,
    badge: 'DENY',
    chips: {
      outcome: 'DENY',
      value: `$${sim.denyAmount ?? 2000}`,
      scope: 'All types',
    },
    testType: 'transaction',
  });

  if (sim.consentTypes) {
    txRules.push({
      id: 'consent-types',
      name: 'Transfer type rule',
      desc: `The following transaction types always require consent regardless of amount: ${sim.consentTypes}.`,
      badge: 'CONSENT',
      chips: {
        outcome: 'CONSENT',
        value: '—',
        scope: sim.consentTypes,
      },
      testType: 'transaction',
    });
  }

  if (sim.stepUpTypes) {
    txRules.push({
      id: 'stepup-types',
      name: 'Step-up type rule',
      desc: `The following transaction types always require MFA regardless of amount: ${sim.stepUpTypes}.`,
      badge: 'STEP-UP',
      chips: {
        outcome: 'STEP-UP',
        value: '—',
        scope: sim.stepUpTypes,
      },
      testType: 'transaction',
    });
  }

  if (flags.ff_authorize_mcp_first_tool) {
    mcpRules.push({
      id: 'mcp-gate',
      name: 'MCP First Tool Gate',
      desc: 'The authorization policy is evaluated on the first MCP tool call per session. Subsequent tool calls in the same session are not re-evaluated unless the session changes.',
      badge: 'GATE',
      chips: {
        outcome: 'GATE',
        value: '—',
        scope: 'First call / session',
      },
      testType: 'mcp',
    });
  }

  const denyCount = (sim.mcpDenyTools || []).length;
  mcpRules.push({
    id: 'mcp-deny',
    name: 'Denied tools',
    desc: denyCount === 0
      ? 'No MCP tools are currently explicitly denied. Any tool not otherwise gated will be permitted.'
      : `The following MCP tools are explicitly denied: ${(sim.mcpDenyTools || []).join(', ')}.`,
    badge: 'DENY',
    chips: {
      outcome: 'DENY',
      value: `${denyCount} tool${denyCount !== 1 ? 's' : ''}`,
      scope: denyCount === 0 ? 'None configured' : (sim.mcpDenyTools || []).join(', '),
    },
    testType: 'mcp',
  });

  const hitlCount = (sim.mcpHitlTools || []).length;
  mcpRules.push({
    id: 'mcp-hitl',
    name: 'HITL tools',
    desc: hitlCount === 0
      ? 'No MCP tools currently require human-in-the-loop approval.'
      : `The following MCP tools require human approval before execution: ${(sim.mcpHitlTools || []).join(', ')}.`,
    badge: 'HITL',
    chips: {
      outcome: 'HITL',
      value: `${hitlCount} tool${hitlCount !== 1 ? 's' : ''}`,
      scope: hitlCount === 0 ? 'None configured' : (sim.mcpHitlTools || []).join(', '),
    },
    testType: 'mcp',
  });

  return { txRules, mcpRules };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AuthorizeRulesPanel() {
  const [config, setConfig] = useState(null);
  const [evalStatus, setEvalStatus] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [adminFallback, setAdminFallback] = useState(false); // true if config fetch 401/403
  const [selectedRuleId, setSelectedRuleId] = useState(null);

  // Test form state
  const [testAmount, setTestAmount] = useState('');
  const [testType, setTestType] = useState('deposit');
  const [testAcr, setTestAcr] = useState('');
  const [testTool, setTestTool] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState(null);

  // Fetch config + engine status on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setConfigLoading(true);
      setConfigError(null);

      // Always fetch engine status (no admin required)
      let status = null;
      try {
        const res = await bffAxios.get('/api/authorize/evaluation-status');
        if (!cancelled) status = res.data;
      } catch {
        // non-fatal — engine note will show unknown
      }

      // Fetch full config (admin-only)
      try {
        const res = await bffAxios.get('/api/admin/authorize/config');
        if (!cancelled) {
          setConfig(res.data);
          setEvalStatus(status);
          setAdminFallback(false);
          setConfigLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        const status4xx = err.response?.status;
        if (status4xx === 401 || status4xx === 403) {
          setAdminFallback(true);
        } else {
          setConfigError(err.response?.data?.message || 'Failed to load authorize config');
        }
        setEvalStatus(status);
        setConfigLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Set default selected rule once config loads
  useEffect(() => {
    if (config && !selectedRuleId) {
      const { txRules } = buildRules(config, evalStatus);
      if (txRules.length > 0) setSelectedRuleId(txRules[0].id);
    }
  }, [config, evalStatus, selectedRuleId]);

  // Run test evaluation
  const handleRunTest = useCallback(async (rule) => {
    setTestRunning(true);
    setTestResult(null);
    setTestError(null);
    try {
      if (rule.testType === 'mcp') {
        // For MCP tool rules, use test-evaluate with a dummy amount and the tool name
        // The endpoint doesn't natively accept a toolName, so we pass amount=0 type=deposit
        // and note the tool check is config-based (shown from rule chips, not live eval)
        setTestResult({
          decision: rule.id === 'mcp-deny' ? 'DENY' : rule.id === 'mcp-hitl' ? 'HITL' : 'GATE',
          note: testTool
            ? `Tool "${testTool}" is ${(config?.simulated?.mcpDenyTools || []).includes(testTool)
                ? 'in the deny list — DENIED'
                : (config?.simulated?.mcpHitlTools || []).includes(testTool)
                  ? 'in the HITL list — requires human approval'
                  : 'not in any deny/HITL list — PERMITTED'}`
            : 'Enter a tool name above to check it against the deny and HITL lists.',
        });
      } else {
        const res = await bffAxios.post('/api/authorize/test-evaluate', {
          amount: parseFloat(testAmount) || 0,
          type: testType || 'deposit',
          acr: testAcr || undefined,
        });
        setTestResult(res.data);
      }
    } catch (err) {
      setTestError(err.response?.data?.error || err.message || 'Evaluation failed');
    } finally {
      setTestRunning(false);
    }
  }, [testAmount, testType, testAcr, testTool, config]);

  // Derived data
  const rules = config ? buildRules(config, evalStatus) : { txRules: [], mcpRules: [] };
  const allRules = [...rules.txRules, ...rules.mcpRules];
  const selectedRule = allRules.find(r => r.id === selectedRuleId) || null;
  const activeEngine = evalStatus?.activeEngine || config?.status?.activeEngine || 'unknown';

  return (
    <div style={{ border: '1px solid #e5e5e5', borderRadius: '8px', overflow: 'hidden', background: '#fff', marginBottom: '24px' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#111' }}>Authorize Rules</h3>
        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#666' }}>
          Browse the active authorization policy rules and test transactions against the engine.
        </p>
      </div>

      <div style={{ display: 'flex', minHeight: '400px' }}>
        {/* LEFT: Rule list */}
        <RuleList
          loading={configLoading}
          error={configError}
          adminFallback={adminFallback}
          txRules={rules.txRules}
          mcpRules={rules.mcpRules}
          selectedRuleId={selectedRuleId}
          onSelect={(id) => {
            setSelectedRuleId(id);
            setTestResult(null);
            setTestError(null);
          }}
        />

        {/* RIGHT: Detail + test */}
        <RuleDetail
          rule={selectedRule}
          activeEngine={activeEngine}
          config={config}
          adminFallback={adminFallback}
          testAmount={testAmount}
          setTestAmount={setTestAmount}
          testType={testType}
          setTestType={setTestType}
          testAcr={testAcr}
          setTestAcr={setTestAcr}
          testTool={testTool}
          setTestTool={setTestTool}
          testRunning={testRunning}
          testResult={testResult}
          testError={testError}
          onRunTest={() => selectedRule && handleRunTest(selectedRule)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RuleList sub-component
// ---------------------------------------------------------------------------
function RuleList({ loading, error, adminFallback, txRules, mcpRules, selectedRuleId, onSelect }) {
  const listStyle = {
    width: '240px',
    minWidth: '240px',
    borderRight: '1px solid #e5e5e5',
    overflowY: 'auto',
    background: '#fff',
  };

  const groupHeaderStyle = {
    padding: '8px 12px 5px',
    fontSize: '10px',
    fontWeight: 700,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: '.06em',
    borderBottom: '1px solid #f0f0f0',
    background: '#fafafa',
  };

  if (loading) {
    return (
      <div style={listStyle}>
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{ padding: '10px 12px', borderBottom: '1px solid #f3f3f3' }}>
            <div style={{ height: '12px', background: '#f3f3f3', borderRadius: '4px', marginBottom: '6px', width: '70%' }} />
            <div style={{ height: '10px', background: '#f3f3f3', borderRadius: '4px', width: '90%' }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...listStyle, padding: '16px 12px' }}>
        <p style={{ fontSize: '12px', color: '#dc2626' }}>❌ {error}</p>
      </div>
    );
  }

  if (adminFallback) {
    return (
      <div style={{ ...listStyle, padding: '16px 12px' }}>
        <p style={{ fontSize: '12px', color: '#666' }}>Sign in as an admin to see rule details.</p>
      </div>
    );
  }

  return (
    <div style={listStyle}>
      <div style={groupHeaderStyle}>Transaction Rules</div>
      {txRules.map(rule => (
        <RuleCard key={rule.id} rule={rule} selected={rule.id === selectedRuleId} onSelect={onSelect} />
      ))}
      <div style={{ ...groupHeaderStyle, marginTop: '4px' }}>MCP Tool Rules</div>
      {mcpRules.map(rule => (
        <RuleCard key={rule.id} rule={rule} selected={rule.id === selectedRuleId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function RuleCard({ rule, selected, onSelect }) {
  return (
    <div
      onClick={() => onSelect(rule.id)}
      style={{
        padding: '10px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid #f3f3f3',
        borderLeft: selected ? '3px solid #4f46e5' : '3px solid transparent',
        background: selected ? '#eef2ff' : '#fff',
        transition: 'background .1s',
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#111', marginBottom: '3px' }}>{rule.name}</div>
      <div style={{ fontSize: '11px', color: '#777', lineHeight: 1.4, marginBottom: '5px' }}>{rule.chips.value !== '—' ? rule.chips.value : rule.chips.scope}</div>
      <Badge type={rule.badge} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// RuleDetail sub-component
// ---------------------------------------------------------------------------
function RuleDetail({
  rule, activeEngine, config, adminFallback,
  testAmount, setTestAmount, testType, setTestType,
  testAcr, setTestAcr, testTool, setTestTool,
  testRunning, testResult, testError, onRunTest,
}) {
  const isMcp = rule?.testType === 'mcp';

  const engineNote = () => {
    if (activeEngine === 'pingone') return 'Active engine: PingOne Authorize. Test evaluations call the live decision endpoint.';
    if (activeEngine === 'simulated') return 'Active engine: Simulated. Configure a PingOne Authorize decision endpoint in the Authorize tab to switch to live policy evaluation.';
    return 'PingOne Authorize is enabled but not fully configured — falling back to simulated engine.';
  };

  const resultDisplay = () => {
    if (testError) return <span style={{ color: '#dc2626' }}>❌ {testError}</span>;
    if (!testResult) return null;
    if (testResult.note) return <span style={{ color: '#374151' }}>{testResult.note}</span>;
    const decision = testResult.stepUpRequired ? 'STEP-UP' : testResult.consentRequired ? 'CONSENT' : testResult.decision;
    const style = BADGE_STYLES[decision] || BADGE_STYLES.PERMIT;
    return (
      <span style={{ ...style, padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
        {decision === 'PERMIT' ? '✅' : decision === 'DENY' ? '❌' : '⚠️'} {decision}
        {testResult.path ? ` — ${testResult.path}` : ''}
      </span>
    );
  };

  return (
    <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto', background: '#fff' }}>
      {!rule && !adminFallback && (
        <p style={{ color: '#999', fontSize: '13px' }}>Select a rule from the list.</p>
      )}

      {adminFallback && (
        <>
          <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
            Sign in as an admin to browse rule details. You can still test the engine below.
          </p>
          <TestForm
            isMcp={false}
            testAmount={testAmount} setTestAmount={setTestAmount}
            testType={testType} setTestType={setTestType}
            testAcr={testAcr} setTestAcr={setTestAcr}
            testTool={testTool} setTestTool={setTestTool}
            testRunning={testRunning}
            onRunTest={onRunTest}
            resultDisplay={resultDisplay()}
          />
          <EngineNote note={engineNote()} />
        </>
      )}

      {rule && (
        <>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#111', marginBottom: '6px' }}>{rule.name}</div>
          <div style={{ fontSize: '13px', color: '#444', lineHeight: 1.6, marginBottom: '14px' }}>{rule.desc}</div>

          {/* Stat chips */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {[
              { label: 'Engine', value: activeEngine === 'pingone' ? 'PingOne' : activeEngine === 'simulated' ? 'Simulated' : 'Unknown', color: activeEngine === 'pingone' ? '#2563eb' : activeEngine === 'simulated' ? '#16a34a' : '#6b7280' },
              { label: 'Outcome', value: rule.chips.outcome, color: (BADGE_STYLES[rule.chips.outcome] || {}).color || '#111' },
              { label: isMcp ? 'Tools' : 'Threshold', value: rule.chips.value, color: '#111' },
              { label: 'Scope', value: rule.chips.scope, color: '#111' },
            ].map(chip => (
              <div key={chip.label} style={{ flex: 1, background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: '7px', padding: '8px 10px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '3px' }}>{chip.label}</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: chip.color }}>{chip.value}</div>
              </div>
            ))}
          </div>

          <TestForm
            isMcp={isMcp}
            testAmount={testAmount} setTestAmount={setTestAmount}
            testType={testType} setTestType={setTestType}
            testAcr={testAcr} setTestAcr={setTestAcr}
            testTool={testTool} setTestTool={setTestTool}
            testRunning={testRunning}
            onRunTest={onRunTest}
            resultDisplay={resultDisplay()}
          />

          <EngineNote note={engineNote()} />
        </>
      )}
    </div>
  );
}

function TestForm({ isMcp, testAmount, setTestAmount, testType, setTestType, testAcr, setTestAcr, testTool, setTestTool, testRunning, onRunTest, resultDisplay }) {
  const inputStyle = { width: '100%', border: '1px solid #d1d5db', borderRadius: '5px', padding: '6px 10px', fontSize: '12px', color: '#111', background: '#fff', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', fontSize: '11px', color: '#666', marginBottom: '4px' };

  return (
    <div style={{ background: '#f8f9fc', border: '1px solid #e5e5e5', borderRadius: '8px', padding: '14px 16px', marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '10px' }}>
        Test this rule
      </div>

      {isMcp ? (
        <div style={{ marginBottom: '10px' }}>
          <label style={labelStyle}>Tool name</label>
          <input style={inputStyle} value={testTool} onChange={e => setTestTool(e.target.value)} placeholder="e.g. get_account_balance" />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Amount (USD)</label>
            <input style={inputStyle} type="number" value={testAmount} onChange={e => setTestAmount(e.target.value)} placeholder="e.g. 300" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Transaction type</label>
            <select style={inputStyle} value={testType} onChange={e => setTestType(e.target.value)}>
              <option value="deposit">deposit</option>
              <option value="withdrawal">withdrawal</option>
              <option value="transfer">transfer</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>ACR (optional)</label>
            <input style={inputStyle} value={testAcr} onChange={e => setTestAcr(e.target.value)} placeholder="e.g. MFA" />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={onRunTest}
          disabled={testRunning}
          style={{ background: testRunning ? '#6366f1' : '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 18px', fontSize: '12px', fontWeight: 600, cursor: testRunning ? 'default' : 'pointer', opacity: testRunning ? 0.8 : 1 }}
        >
          {testRunning ? 'Evaluating…' : 'Run evaluation'}
        </button>
        {resultDisplay}
      </div>
    </div>
  );
}

function EngineNote({ note }) {
  return (
    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '9px 12px', fontSize: '11px', color: '#1e40af', lineHeight: 1.5 }}>
      <strong style={{ color: '#1e3a8a' }}>Engine: </strong>{note}
    </div>
  );
}
```

- [ ] **Step 2: Verify the file parses (no syntax errors)**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
node --input-type=module --eval "import('./src/components/AuthorizeRulesPanel.jsx')" 2>&1 | head -5
```

This will likely error on JSX (Node doesn't parse JSX natively) — that's fine. What you're checking is that the build step below succeeds, not this Node check. Skip to Step 3.

- [ ] **Step 3: Build the UI to confirm no compilation errors**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.` or `webpack compiled successfully`

If there are errors, fix them before proceeding. Common issues: missing closing brackets, wrong import paths.

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/AuthorizeRulesPanel.jsx
git commit -m "feat(ui): add AuthorizeRulesPanel component"
```

---

## Task 3: Wire panel into UserDashboard (feature-flagged)

**Files:**
- Modify: `demo_api_ui/src/components/UserDashboard.js`

The pattern to follow is how `ff_show_banking_in_middle_agent` is fetched and used (lines ~162–179).

- [ ] **Step 1: Add import at the top of UserDashboard.js**

Find the existing imports block near the top of `demo_api_ui/src/components/UserDashboard.js`. Add after the last component import:

```javascript
import AuthorizeRulesPanel from './AuthorizeRulesPanel';
```

- [ ] **Step 2: Add state for the feature flag**

Find the `showBankingInMiddle` state declaration (around line 160). Add the new flag state immediately after it:

```javascript
const [showBankingInMiddle, setShowBankingInMiddle] = useState(false);
const [showAuthorizeRulesPanel, setShowAuthorizeRulesPanel] = useState(false);
```

- [ ] **Step 3: Fetch the flag in the existing feature-flags useEffect**

Find the `useEffect` that fetches `/api/admin/feature-flags` and reads `ff_show_banking_in_middle_agent` (around line 162). It looks like:

```javascript
useEffect(() => {
  let cancelled = false;
  fetch("/api/admin/feature-flags", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (cancelled) return;
      const flag = data?.flags?.find(
        (f) => f.id === "ff_show_banking_in_middle_agent",
      );
      if (flag != null) setShowBankingInMiddle(Boolean(flag.value));
    })
    .catch(() => {
      /* fail to the clean default (column hidden) */
    });
  return () => {
    cancelled = true;
  };
}, []);
```

Add the authorize rules panel flag read inside the same `.then` callback, after the existing `setShowBankingInMiddle` line:

```javascript
    .then((data) => {
      if (cancelled) return;
      const flag = data?.flags?.find(
        (f) => f.id === "ff_show_banking_in_middle_agent",
      );
      if (flag != null) setShowBankingInMiddle(Boolean(flag.value));
      const authorizeFlag = data?.flags?.find(
        (f) => f.id === "ff_authorize_rules_panel",
      );
      if (authorizeFlag != null) setShowAuthorizeRulesPanel(Boolean(authorizeFlag.value));
    })
```

- [ ] **Step 4: Render the panel in the float-mode layout**

Find the float-mode layout section (around line 2707–2735) — this is the `ud-body--floating` section that renders when `agentPlacement === "none"`. Inside this section, after the main banking content div closes but before the section wrapper closes, add:

```jsx
{showAuthorizeRulesPanel && (
  <div style={{ padding: '0 16px 16px' }}>
    <AuthorizeRulesPanel />
  </div>
)}
```

To find the right spot: search for `ud-body--floating` in UserDashboard.js, then look for where the inner banking content div ends. Place the block after it.

- [ ] **Step 5: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/UserDashboard.js
git commit -m "feat(dashboard): render AuthorizeRulesPanel when ff_authorize_rules_panel enabled"
```

---

## Task 4: Wire panel into UnifiedConfigurationPage (Authorize tab)

**Files:**
- Modify: `demo_api_ui/src/components/Configuration/UnifiedConfigurationPage.tsx`

- [ ] **Step 1: Add import**

Find the existing imports near the top of `demo_api_ui/src/components/Configuration/UnifiedConfigurationPage.tsx`. Find the line:

```typescript
import AuthorizeConfigPage from "../AuthorizeConfigPage";
```

Add immediately after it:

```typescript
import AuthorizeRulesPanel from "../AuthorizeRulesPanel";
```

- [ ] **Step 2: Insert panel above AuthorizeConfigPage**

Find the section renderer for `authorize-rules` (around line 3744). It currently looks like:

```jsx
if (s === "authorize-rules") {
  return (
    <div className="cfg-section cfg-section--full-width">
      <AuthorizeConfigPage />
    </div>
  );
}
```

Replace it with:

```jsx
if (s === "authorize-rules") {
  return (
    <div className="cfg-section cfg-section--full-width">
      <AuthorizeRulesPanel />
      <AuthorizeConfigPage />
    </div>
  );
}
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -20
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/Configuration/UnifiedConfigurationPage.tsx
git commit -m "feat(configure): add AuthorizeRulesPanel to Authorize tab above config page"
```

---

## Task 5: Smoke test end-to-end

- [ ] **Step 1: Start services**

```bash
cd /Users/curtismuir/Development/AI-Demo
./run.sh
```

Wait for all services to report healthy (`./run.sh status`).

- [ ] **Step 2: Verify panel appears in /configure → Authorize tab**

1. Open `https://api.ping.demo:4000/configure`
2. Click the **Authorize** tab
3. Confirm `AuthorizeRulesPanel` appears above the existing `AuthorizeConfigPage`
4. Confirm rule cards load (Confirm threshold, Step-up threshold, etc.)
5. Select a rule — confirm detail panel shows title, description, stat chips
6. Enter an amount (e.g. 300) and type (deposit), click **Run evaluation**
7. Confirm result badge appears (CONSENT / PERMIT / DENY / STEP-UP)

- [ ] **Step 3: Verify dashboard panel is flag-gated (off by default)**

1. Open `https://api.ping.demo:4000/dashboard`
2. Confirm `AuthorizeRulesPanel` is NOT visible (flag is `false` by default)

- [ ] **Step 4: Enable flag and verify dashboard panel appears**

1. Open `https://api.ping.demo:4000/configure` → **Feature Flags** tab
2. Toggle `ff_authorize_rules_panel` to `true` and save
3. Reload `https://api.ping.demo:4000/dashboard`
4. Confirm `AuthorizeRulesPanel` now appears below the banking content
5. Confirm it loads rules and the test form works

- [ ] **Step 5: Verify admin fallback on dashboard**

If testing with a non-admin user: confirm the rule list shows "Sign in as an admin to see rule details" and the test form is still accessible.

- [ ] **Step 6: Run UI build one final time to confirm clean state**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

- [ ] **Step 7: Final commit (if any cleanup needed)**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add -A
git commit -m "chore: verify AuthorizeRulesPanel end-to-end smoke test"
```

---

## Regression checklist

Before marking done, confirm:
- [ ] `npm run build` in `demo_api_ui/` exits 0
- [ ] Admin login → `/admin` still works
- [ ] User login → `/dashboard` still works (panel hidden by default)
- [ ] `/configure → Authorize` tab shows panel above existing config
- [ ] No new `console.error` in flows you haven't changed
- [ ] OAuth callbacks still resolve to `https://api.ping.demo:4000` (not localhost)
