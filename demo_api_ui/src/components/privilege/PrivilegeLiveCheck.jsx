// demo_api_ui/src/components/privilege/PrivilegeLiveCheck.jsx
//
// "Go through Privilege" control for the platform-update pages. Renders a
// button that sends the page's mapped scenario through the BFF to the tenant's
// live Privilege AI Gateway and shows the gateway's actual verdict — including
// a policy refusal — next to the page's documented-behaviour model.
//
// Honesty rule: this component never invents an outcome. Whatever it shows
// came from the gateway's response (or a clearly-labelled failure to reach it).

import { useState } from 'react';
import { callPrivilegeDecision } from '../../lib/privilegeDecisionClient';
import './PrivilegeLiveCheck.css';

const DECISION_LABEL = {
  allowed: { label: 'Gateway allowed the call', cls: 'plc-allowed', chip: 'Allowed', tone: 'ok' },
  denied: { label: 'Gateway denied the call (policy)', cls: 'plc-denied', chip: 'Denied', tone: 'danger' },
  tool_error: { label: 'Gateway let the call through; the tool answered with an error', cls: 'plc-tool-error', chip: 'Tool error', tone: 'warn' },
};

// A page that follows the standalone UI standard passes its own button class (so the
// trigger is a secondary there, one primary per view) and statusChip (a word-bearing
// chip in the result, P7). The defaults leave every other page exactly as it was.
function Chip({ tone, children }) {
  return (
    <span className={`plc__chip plc__chip--${tone}`}>
      <span className="plc__chip-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export default function PrivilegeLiveCheck({
  tool,
  args,
  label = 'Run through live Privilege',
  onDone,
  buttonClassName = 'btn btn-primary',
  statusChip = false,
}) {
  const [state, setState] = useState({ phase: 'idle' });

  async function run() {
    setState({ phase: 'running' });
    try {
      const result = await callPrivilegeDecision(tool, args);
      setState({ phase: 'done', result });
      if (onDone) onDone(result);
    } catch (err) {
      setState({ phase: 'error', message: err.message });
    }
  }

  return (
    <div className="plc" data-testid="privilege-live-check">
      <div className="plc__row">
        <button
          type="button"
          className={`${buttonClassName} plc__run`}
          onClick={run}
          disabled={state.phase === 'running'}
        >
          {state.phase === 'running' ? 'Calling the gateway…' : label}
        </button>
        <span className="plc__hint">Live call: this machine’s BFF → Privilege AI Gateway → tool</span>
      </div>
      {state.phase === 'done' && (
        <div className={`plc__result ${DECISION_LABEL[state.result.decision]?.cls ?? ''}`} role="status" data-testid="plc-verdict">
          {statusChip && DECISION_LABEL[state.result.decision] && (
            <Chip tone={DECISION_LABEL[state.result.decision].tone}>{DECISION_LABEL[state.result.decision].chip}</Chip>
          )}
          <strong>{DECISION_LABEL[state.result.decision]?.label ?? state.result.decision}</strong>
          <span className="plc__meta">{state.result.latencyMs} ms · HTTP {state.result.status} · decided by {state.result.by}</span>
          {state.result.upstream && <pre className="plc__upstream">{String(state.result.upstream).slice(0, 600)}</pre>}
        </div>
      )}
      {state.phase === 'error' && (
        <div className="plc__result plc-error" role="alert">
          {statusChip && <Chip tone="warn">Unreachable</Chip>}
          <strong>Could not reach the gateway</strong>
          <p>{state.message}</p>
        </div>
      )}
    </div>
  );
}
