import React from 'react';
import './AgentLifecyclePage.css';
import { callMcpTool } from '../services/demoAgentService';
import TokenChainTraceRail from '../components/TokenChainTraceRail';
import { getAgents } from '../services/controlPlaneApi';
import apiClient from '../services/apiClient';
import KillSwitchConfirmModal from '../components/KillSwitchConfirmModal';
import { useAgentUiMode } from '../context/AgentUiModeContext';

function RegistrationSlot() {
  return (
    <section className="alp-slot alp-slot--video">
      <h2 className="alp-slot__title">1. Register agent + scoped consent</h2>
      <p className="alp-slot__desc">
        A user registers an AI agent and delegates account access via a
        scoped consent screen. Recorded walkthrough (live registration isn't
        built yet):
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

function ScopedCallSlot() {
  const [status, setStatus] = React.useState('idle'); // idle | loading | done | error
  const [orders, setOrders] = React.useState(null);
  const [error, setError] = React.useState(null);

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
        <pre className="alp-result">{JSON.stringify(orders, null, 2)}</pre>
      )}
      {status === 'error' && <p className="alp-error">{error}</p>}
    </section>
  );
}

function StepUpSlot() {
  const [phase, setPhase] = React.useState('idle'); // idle | checking-out | waiting-approval | approved | error
  const [message, setMessage] = React.useState('');
  const timerRef = React.useRef(null);

  const postCheckout = React.useCallback(async () => {
    const res = await fetch('/api/mcp/tool', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'checkout',
        params: { product: 'Headphones', amount: 600 },
        useCaseId: 'ciba-out-of-band-approval',
        vertical: 'retail',
      }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body };
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
    try {
      const { status, ok, body } = await postCheckout();
      if (status === 428 && body.error === 'mcp_step_up_required' && body.step_up_method === 'ciba') {
        const initRes = await fetch('/api/auth/ciba/initiate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ binding_message: 'Approve your $600 headphones purchase' }),
        });
        const { auth_req_id, interval } = await initRes.json();
        setPhase('waiting-approval');
        setMessage(`Waiting for push approval (auth_req_id: ${auth_req_id})…`);
        pollCiba(auth_req_id, (interval || 5) * 1000);
        return;
      }
      if (!ok) {
        setPhase('error');
        setMessage(body.message || body.error_description || `HTTP ${status}`);
        return;
      }
      setPhase('approved');
      setMessage('Checkout completed.');
    } catch (err) {
      setPhase('error');
      setMessage(err.message || 'Checkout failed');
    }
  }, [postCheckout, pollCiba]);

  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  const busy = phase === 'checking-out' || phase === 'waiting-approval';

  return (
    <section className="alp-slot">
      <h2 className="alp-slot__title">3. Step-up approval on a sensitive purchase</h2>
      <p className="alp-slot__desc">
        Checks out $600 of headphones with the same agent-scoped path — above
        the retail step-up threshold, so PingOne Authorize requires a CIBA
        push approval before the purchase completes.
      </p>
      <button className="alp-btn" type="button" onClick={runCheckout} disabled={busy}>
        {busy ? 'Processing…' : 'Checkout $600 headphones'}
      </button>
      {message && <p className="alp-slot__status">{message}</p>}
    </section>
  );
}

function RevokeSlot() {
  const [agentId, setAgentId] = React.useState(null);
  const [showModal, setShowModal] = React.useState(false);
  const [revoked, setRevoked] = React.useState(false);
  const [retryResult, setRetryResult] = React.useState('');

  React.useEffect(() => {
    getAgents()
      .then((data) => setAgentId(data?.live?.id || 'demo-agent'))
      .catch(() => setAgentId('demo-agent'));
  }, []);

  const confirmRevoke = React.useCallback(async (id, reason) => {
    try {
      await apiClient.post(`/api/admin/agent/${id}/kill-switch`, { reason });
    } catch (_) {
      // A 401 here is expected once the session dies mid-request — the
      // retry below is the real proof, not this call's own success.
    }
    setShowModal(false);
    setRevoked(true);
    try {
      const { result } = await callMcpTool('list_orders', {}, { vertical: 'retail' });
      setRetryResult(`Unexpected: call still succeeded (${JSON.stringify(result)})`);
    } catch (err) {
      setRetryResult(`Confirmed revoked — retry failed: ${err.message}`);
    }
  }, []);

  return (
    <section className="alp-slot">
      <h2 className="alp-slot__title">4. Self-service revoke</h2>
      <p className="alp-slot__desc">
        Revokes this agent's access via the same kill-switch the AI Control
        Plane page uses. This ends your own session — real kill-switch
        semantics, not a simulation.
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
        <a
          className="alp-audit-link"
          href={`/audit?agentId=${agentId}`}
          target="_blank"
          rel="noreferrer"
        >
          View audit trail →
        </a>
      )}
    </section>
  );
}

export default function AgentLifecyclePage() {
  const { setSurfaceHostEl } = useAgentUiMode();
  const [agentHostEl, setAgentHostEl] = React.useState(null);
  const agentHostRef = React.useCallback((node) => setAgentHostEl(node), []);

  React.useEffect(() => {
    if (agentHostEl) {
      setSurfaceHostEl(agentHostEl);
      return () => setSurfaceHostEl((cur) => (cur === agentHostEl ? null : cur));
    }
  }, [agentHostEl, setSurfaceHostEl]);

  return (
    <div className="alp-wrap">
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
