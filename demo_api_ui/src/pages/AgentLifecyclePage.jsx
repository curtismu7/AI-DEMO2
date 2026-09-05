import React from 'react';
import './AgentLifecyclePage.css';
import { callMcpTool } from '../services/demoAgentService';
import TokenChainTraceRail from '../components/TokenChainTraceRail';
import { getAgents } from '../services/controlPlaneApi';
import apiClient from '../services/apiClient';
import KillSwitchConfirmModal from '../components/KillSwitchConfirmModal';
import { useAgentUiMode } from '../context/AgentUiModeContext';
import { useThemeOptional } from '../context/ThemeContext';

function RegistrationSlot() {
  return (
    <section className="alp-slot alp-slot--video">
      <h2 className="alp-slot__title">1. Register agent + scoped consent</h2>
      <p className="alp-slot__desc">
        A user registers an AI agent and delegates account access via a scoped
        consent screen. This step is live: <a href="/agent-builder">PingOne
        Agent Builder</a> creates a real PingOne application for the signed-in
        user and sets its resource grants, and the new identity then appears in
        the <a href="/agent-registry">Agent Registry</a> alongside every other
        agent and workload identity.
      </p>
      <p className="alp-slot__desc">
        The recording below walks through the same step end to end, including
        the consent screen:
      </p>
      <video
        className="alp-video"
        src="/media/contractor-lcm-ai-agent.mp4"
        controls
        aria-label="Agent registration and consent walkthrough"
      />
    </section>
  );
}

function OrdersFormView({ orders }) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return <p className="alp-form-empty">No orders to display</p>;
  }

  return (
    <div className="alp-form-container">
      {orders.map((order, idx) => (
        <div key={idx} className="alp-form-card">
          <div className="alp-form-grid">
            {Object.entries(order).map(([key, value]) => (
              <div key={key} className="alp-form-field">
                <label className="alp-form-label">{key}</label>
                <div className="alp-form-value">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopedCallSlot() {
  const [status, setStatus] = React.useState('idle'); // idle | loading | done | error
  const [orders, setOrders] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [viewMode, setViewMode] = React.useState('form'); // form | raw

  const run = React.useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const { result } = await callMcpTool('list_orders', {}, { vertical: 'retail' });
      const text = result?.content?.[0]?.text;
      const parsed = text ? JSON.parse(text) : result;
      setOrders(parsed?.orders ?? parsed ?? []);
      setStatus('done');
    } catch (err) {
      setError(err.message || 'Call failed');
      setStatus('error');
    }
  }, []);

  return (
    <section className="alp-slot">
      <h2 className="alp-slot__title">2. Agent calls MCP with a scoped, revocable token</h2>
      <p className="alp-slot__desc">
        Calls the retail <code>list_orders</code> tool through the same RFC
        8693 token-exchange + gateway path every chip click uses.
      </p>
      <button className="alp-btn" type="button" onClick={run} disabled={status === 'loading'}>
        {status === 'loading' ? 'Calling…' : 'Call list_orders as agent'}
      </button>
      {status === 'done' && (
        <>
          <div className="alp-view-toggle">
            <button
              type="button"
              className={`alp-view-btn ${viewMode === 'form' ? 'alp-view-btn--active' : ''}`}
              onClick={() => setViewMode('form')}
            >
              Pretty Form
            </button>
            <button
              type="button"
              className={`alp-view-btn ${viewMode === 'raw' ? 'alp-view-btn--active' : ''}`}
              onClick={() => setViewMode('raw')}
            >
              Raw JSON
            </button>
          </div>
          {viewMode === 'form' ? (
            <OrdersFormView orders={orders} />
          ) : (
            <pre className="alp-result">{JSON.stringify(orders, null, 2)}</pre>
          )}
        </>
      )}
      {status === 'error' && <p className="alp-error">{error}</p>}
    </section>
  );
}

function StepUpSlot() {
  const [phase, setPhase] = React.useState('idle'); // idle | checking-out | waiting-approval | approved | error
  const [message, setMessage] = React.useState('');
  const timerRef = React.useRef(null);

  // Routed through callMcpTool (same as ScopedCallSlot's list_orders call above)
  // so this checkout shows up in the Token Chain rail / right-side agent panel
  // instead of running invisibly via a bare fetch.
  //
  // callMcpTool deliberately resolves (does not throw) on HITL 428 so the
  // banking agent can open a consent modal. This page has no modal — treat
  // those soft-success payloads as failed checkout, or we falsely show
  // "Checkout completed" when authorize still blocked the purchase.
  const postCheckout = React.useCallback(async () => {
    try {
      const { result } = await callMcpTool(
        'checkout',
        { product: 'Headphones', amount: 600 },
        { useCaseId: 'ciba-out-of-band-approval', vertical: 'retail' },
      );
      const softGate =
        result?.error === 'mcp_hitl_required' ||
        result?.error === 'hitl_required' ||
        result?.error === 'mcp_step_up_required' ||
        result?.error === 'step_up_required';
      if (softGate) {
        return {
          status: 428,
          ok: false,
          body: {
            error: result.error,
            message: result.error_description || result.message || result.error,
          },
        };
      }
      // callMcpTool resolves (does not throw) for some soft failures — treat
      // any remaining error payload as a failed checkout, not success.
      if (result?.error) {
        return {
          status: 502,
          ok: false,
          body: {
            error: result.error,
            message: result.error_description || result.message || result.error,
          },
        };
      }
      return { status: 200, ok: true, body: { result } };
    } catch (err) {
      const code = err.code || err.error || err.data?.error;
      return {
        status: err.statusCode || 500,
        ok: false,
        body: {
          error: code,
          message: err.message || code || `HTTP ${err.statusCode || 500}`,
        },
      };
    }
  }, []);

  const pollCiba = React.useCallback((authReqId, intervalMs) => {
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/ciba/poll/${authReqId}`, { credentials: 'include' });
        if (res.status === 403 || res.status === 404 || res.status === 410) {
          setPhase('error');
          setMessage('CIBA approval was denied or expired.');
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (data.status === 'approved') {
          setMessage('Approved — retrying checkout…');
          const retry = await postCheckout();
          if (retry.ok) {
            setPhase('approved');
            setMessage('Checkout completed.');
          } else {
            setPhase('error');
            setMessage(retry.body.message || `Retry failed: HTTP ${retry.status}`);
          }
          return;
        }
        pollCiba(authReqId, intervalMs);
      } catch (err) {
        setPhase('error');
        setMessage(err.message || 'CIBA polling failed');
      }
    }, intervalMs);
  }, [postCheckout]);

  const runCheckout = React.useCallback(async () => {
    setPhase('checking-out');
    setMessage('');
    const { status, ok, body } = await postCheckout();
    // Step-up and HITL both clear via CIBA approval (session stepUpVerified +
    // hitlVerified). Start CIBA for either 428 — otherwise a HITL-only gate
    // would fall through to a false "Checkout completed".
    const needsCiba =
      status === 428 &&
      (body.error === 'mcp_step_up_required' ||
        body.error === 'mcp_hitl_required' ||
        body.error === 'hitl_required');
    if (needsCiba) {
      try {
        const initRes = await fetch('/api/auth/ciba/initiate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ binding_message: 'Approve your $600 headphones purchase' }),
        });
        const { auth_req_id, interval } = await initRes.json();
        setPhase('waiting-approval');
        // This environment's CIBA runs against the simulated backchannel
        // engine (no PingOne CIBA platform provisioning yet — see
        // docs/superpowers/plans/2026-07-20-ciba-real-platform-provisioning.md),
        // which auto-approves after a few seconds. There is no push/email
        // action for the user to take today.
        setMessage(`Waiting for approval (auth_req_id: ${auth_req_id})… this demo auto-approves in a few seconds — no action needed.`);
        pollCiba(auth_req_id, (interval || 5) * 1000);
      } catch (err) {
        setPhase('error');
        setMessage(err.message || 'Failed to start CIBA approval');
      }
      return;
    }
    if (!ok) {
      setPhase('error');
      setMessage(body.message || `HTTP ${status}`);
      return;
    }
    setPhase('approved');
    setMessage('Checkout completed.');
  }, [postCheckout, pollCiba]);

  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  const busy = phase === 'checking-out' || phase === 'waiting-approval';

  return (
    <section className="alp-slot">
      <h2 className="alp-slot__title">3. Step-up approval on a sensitive purchase</h2>
      <p className="alp-slot__desc">
        Checks out $600 of headphones with the same agent-scoped path — above
        the retail step-up threshold, so PingOne Authorize requires a CIBA
        step-up approval before the purchase completes.
      </p>
      <button className="alp-btn" type="button" onClick={runCheckout} disabled={busy}>
        {busy ? 'Processing…' : 'Checkout $600 headphones'}
      </button>
      {message && (
        <p className="alp-slot__status">
          {phase === 'waiting-approval' && <span className="alp-spinner" aria-hidden="true" />}
          {message}
        </p>
      )}
    </section>
  );
}

function RevokeSlot() {
  const [agentId, setAgentId] = React.useState(null);
  const [showModal, setShowModal] = React.useState(false);
  const [revoked, setRevoked] = React.useState(false);
  const [retryResult, setRetryResult] = React.useState('');
  const [reenableBusy, setReenableBusy] = React.useState(false);
  const [lastScope, setLastScope] = React.useState('instance');

  React.useEffect(() => {
    getAgents()
      .then((data) => setAgentId(data?.live?.id || 'demo-agent'))
      .catch(() => setAgentId('demo-agent'));
  }, []);

  // Must forward the modal's scope. Omitting it lets the API default to
  // scope=full, which disables the PingOne agent apps for every user.
  const confirmRevoke = React.useCallback(async (id, reason, scope = 'instance') => {
    setLastScope(scope);
    try {
      await apiClient.post(`/api/admin/agent/${id}/kill-switch`, { reason, scope });
    } catch (_) {
      // A 401 here is expected once the session dies mid-request — the
      // retry below is the real proof, not this call's own success.
    }
    setShowModal(false);
    setRevoked(true);
    try {
      const { result } = await callMcpTool('list_orders', {}, { vertical: 'retail' });
      // callMcpTool often resolves (no throw) with an error payload when the
      // session/token is gone — treat that as confirmed revoke, not success.
      if (result?.error) {
        setRetryResult(`Confirmed revoked — retry failed: ${result.error}`);
      } else {
        setRetryResult(`Unexpected: call still succeeded (${JSON.stringify(result)})`);
      }
    } catch (err) {
      setRetryResult(`Confirmed revoked — retry failed: ${err.message}`);
    }
  }, []);

  const reenableAgent = React.useCallback(async () => {
    if (!agentId) return;
    setReenableBusy(true);
    try {
      await apiClient.post(`/api/admin/agent/${agentId}/re-enable`, {});
      setRetryResult('Agent applications re-enabled — sign in again to continue the demo.');
      setRevoked(false);
    } catch (err) {
      setRetryResult(`Re-enable failed: ${err.message || 'request failed'}`);
    } finally {
      setReenableBusy(false);
    }
  }, [agentId]);

  return (
    <section className="alp-slot">
      <h2 className="alp-slot__title">4. Self-service revoke</h2>
      <p className="alp-slot__desc">
        Revokes this agent's access via the same kill-switch the AI Control
        Plane page uses. This ends your own session — real kill-switch
        semantics, not a simulation. Prefer &quot;This instance only&quot; so
        the PingOne agent app stays enabled for the rest of the demo.
      </p>
      <button
        className="alp-btn"
        type="button"
        onClick={() => setShowModal(true)}
        disabled={!agentId || revoked}
      >
        {revoked ? 'Revoked' : 'Revoke agent access'}
      </button>
      <KillSwitchConfirmModal
        isOpen={showModal}
        agentId={agentId}
        onConfirm={confirmRevoke}
        onCancel={() => setShowModal(false)}
      />
      {retryResult && <p className="alp-slot__status">{retryResult}</p>}
      {revoked && (
        <>
          <a
            className="alp-audit-link"
            href={`/audit?agentId=${agentId}`}
            target="_blank"
            rel="noreferrer"
          >
            View audit trail →
          </a>
          <a
            className="alp-audit-link"
            href={`/api/control-plane/lifecycle-events?agentId=${agentId}`}
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: 12 }}
          >
            View lifecycle export feed →
          </a>
          {lastScope === 'full' && (
            <button
              className="alp-btn"
              type="button"
              onClick={reenableAgent}
              disabled={reenableBusy}
              style={{ marginLeft: 12 }}
            >
              {reenableBusy ? 'Re-enabling…' : 'Re-enable agent apps'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default function AgentLifecyclePage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const { setSurfaceHostEl } = useAgentUiMode();
  const [agentHostEl, setAgentHostEl] = React.useState(null);
  const agentHostRef = React.useCallback((node) => setAgentHostEl(node), []);

  React.useEffect(() => {
    setSurfaceHostEl(agentHostEl);
    return () => setSurfaceHostEl((cur) => (cur === agentHostEl ? null : cur));
  }, [agentHostEl, setSurfaceHostEl]);

  // Retail tools (list_orders / checkout) — pin session vertical so Authorize
  // and gateway headers match the slots below (not whatever vertical was last active).
  React.useEffect(() => {
    Promise.resolve(apiClient.post('/api/verticals/active', { id: 'retail' })).catch(() => {});
  }, []);

  return (
    <div className="alp-wrap">
      <button
        type="button"
        onClick={toggleDarkMode}
        className="alp-theme-toggle"
        title="Switch this page between light and dark"
        aria-pressed={darkMode}
      >
        {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
      </button>
      <h1 className="alp-title">Agent Lifecycle</h1>
      <p className="alp-subtitle">
        Register, call, step up, and revoke — one AI agent's full access
        lifecycle end to end.
      </p>
      <div className="alp-body">
        <div className="alp-slots">
          <RegistrationSlot />
          <ScopedCallSlot />
          <StepUpSlot />
          <RevokeSlot />
        </div>
        <div className="alp-run-layout">
          <div className="alp-agent-host" ref={agentHostRef} />
          <div className="alp-rail-host">
            <TokenChainTraceRail />
          </div>
        </div>
      </div>
    </div>
  );
}
