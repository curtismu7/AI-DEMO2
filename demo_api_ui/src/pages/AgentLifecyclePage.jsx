import React from 'react';
import './AgentLifecyclePage.css';
import { callMcpTool } from '../services/demoAgentService';
import TokenChainTraceRail from '../components/TokenChainTraceRail';

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
      <TokenChainTraceRail />
    </section>
  );
}

export default function AgentLifecyclePage() {
  return (
    <div className="alp-wrap">
      <h1 className="alp-title">Agent Lifecycle</h1>
      <p className="alp-subtitle">
        Register, call, step up, and revoke — one AI agent's full access
        lifecycle end to end.
      </p>
      <RegistrationSlot />
      <ScopedCallSlot />
    </div>
  );
}
