import React from 'react';
import PingIdentitySpinner from '../components/shared/PingIdentitySpinner';
import './AgentLifecyclePage.css';
import { callMcpTool } from '../services/demoAgentService';
import TokenChainTraceRail from '../components/TokenChainTraceRail';
import { getAgents } from '../services/controlPlaneApi';
import apiClient from '../services/apiClient';
import KillSwitchConfirmModal from '../components/KillSwitchConfirmModal';
import { useAgentUiMode } from '../context/AgentUiModeContext';
import { useThemeOptional } from '../context/ThemeContext';
import { PRIMARY_AGENT } from '../config/agentTerminology';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from '../components/pingUi';
import { pickPrimary, approvalWaitMessage } from './agentLifecycleFlow';

// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) on the
// shared primitives (components/pingUi): P2 banner first, P3 frame, P4 cards, P5 key-value, P7 chips with a word,
// P9 one primary button per view state (agentLifecycleFlow.js says which). Not applied: P6 inspector and P8
// diagram boxes (this page has neither; the token-chain rail on the right is a shared child), and the standalone
// shell bar (the app has its own).

export default function AgentLifecyclePage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const { setSurfaceHostEl } = useAgentUiMode();
  const [agentHostEl, setAgentHostEl] = React.useState(null);
  const agentHostRef = React.useCallback((node) => setAgentHostEl(node), []);
  // What the walk has completed so far; pickPrimary turns it into the one primary button.
  const [flow, setFlow] = React.useState({
    orders: false, checkout: false, revoked: false, scopeFull: false, modalOpen: false,
  });
  const patchFlow = React.useCallback((patch) => setFlow((cur) => ({ ...cur, ...patch })), []);
  const ordersDone = React.useCallback(() => patchFlow({ orders: true }), [patchFlow]);
  const checkoutDone = React.useCallback(() => patchFlow({ checkout: true }), [patchFlow]);
  const primary = pickPrimary(flow);

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
    <PingPage className="alp-page">
      <SimBanner data-testid="alp-banner">
        <strong>LIVE AND SIMULATED</strong> — steps 2 and 4 are real: <code className="pu-mono">list_orders</code> runs
        a real token exchange and gateway call (the orders are seeded demo records), and Revoke runs the
        real kill-switch and ends your session. Step 1 is a recording; the Agent Builder it links to is
        live. Step 3 is a demo purchase, no money moves, and its approval is answered by PingOne CIBA or
        by a local simulation, whichever the server reports when the request starts.
      </SimBanner>
      <PageHeader
        eyebrow="Agents · Guided demo"
        title="Agent Lifecycle"
        summary={`Register, call, step up, and revoke — one ${PRIMARY_AGENT.displayName}'s full access lifecycle end to end.`}
        actions={(
          <button
            type="button"
            onClick={toggleDarkMode}
            className="pu-btn"
            title="Switch this page between light and dark"
          >
            {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
          </button>
        )}
      />
      <PageFrame>
        <div className="alp-body">
          <div className="alp-slots">
            <RegistrationSlot />
            <ScopedCallSlot isNext={primary === 'orders'} onDone={ordersDone} />
            <StepUpSlot isNext={primary === 'checkout'} onDone={checkoutDone} />
            <RevokeSlot which={primary} flow={flow} onFlow={patchFlow} />
          </div>
          <div className="alp-run-layout">
            <div className="alp-agent-host" ref={agentHostRef} />
            <div className="alp-rail-host">
              <TokenChainTraceRail />
            </div>
          </div>
        </div>
      </PageFrame>
    </PingPage>
  );
}

// The page's action button. `isNext` marks the one control that is the primary for the current view state
// (pickPrimary in agentLifecycleFlow.js decides); this is the only place a primary class is written.
function ActionButton({ isNext, ...rest }) {
  return <button type="button" className={isNext ? 'pu-btn pu-btn--primary' : 'pu-btn'} {...rest} />;
}

function RegistrationSlot() {
  return (
    <Section id="alp-step-1" kicker="Step 1 of 4 · Register" title="Register agent + scoped consent">
      <Card tone="neutral" data-testid="alp-step-1">
        <p className="pu-status-line">
          <StatusChip tone="neutral">Recording</StatusChip>
          <StatusChip tone="info">Agent Builder is live</StatusChip>
        </p>
        <p className="pu-note">
          A user registers a {PRIMARY_AGENT.displayName} and delegates account access via a scoped
          consent screen. The Agent Builder step is live: <a className="alp-link" href="/agent-builder">PingOne
          Agent Builder</a> creates a real PingOne application for the signed-in
          user and sets its resource grants, and the new identity then appears in
          the <a className="alp-link" href="/agent-registry">Agent Registry</a> alongside every other
          agent and workload identity.
        </p>
        <p className="pu-note">
          The video below is a recording of the same step end to end, including
          the consent screen. It is not a live run.
        </p>
        <video
          className="alp-video"
          src="/media/contractor-lcm-ai-agent.mp4"
          controls
          aria-label="Agent registration and consent walkthrough (recording)"
        />
      </Card>
    </Section>
  );
}

function OrdersView({ orders }) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return <p className="pu-note pu-empty" data-testid="alp-orders-empty">No orders to display</p>;
  }
  return (
    <div className="alp-orders" data-testid="alp-orders">
      {orders.map((order, idx) => (
        <div key={idx} className="alp-order">
          <KvList
            items={Object.entries(order).map(([label, value]) => ({
              label,
              value: typeof value === 'object' ? JSON.stringify(value) : String(value),
            }))}
          />
        </div>
      ))}
    </div>
  );
}

function ScopedCallSlot({ isNext, onDone }) {
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
      // The live gateway nests the list: { success, render, data: { orders } }. Older mocks send { orders }.
      setOrders(parsed?.orders ?? parsed?.data?.orders ?? parsed ?? []);
      setStatus('done');
      onDone();
    } catch (err) {
      setError(err.message || 'Call failed');
      setStatus('error');
    }
  }, [onDone]);

  const busy = status === 'loading';
  const chip = {
    idle: { tone: 'neutral', word: 'Not run' },
    loading: { tone: 'info', word: 'Calling' },
    done: { tone: 'ok', word: Array.isArray(orders) && orders.length ? `Done · ${orders.length} ${orders.length === 1 ? 'order' : 'orders'}` : 'Done · no orders' },
    error: { tone: 'danger', word: 'Failed' },
  }[status];
  const cardTone = status === 'done' ? 'ok' : status === 'error' ? 'danger' : 'live';

  return (
    <Section id="alp-step-2" kicker="Step 2 of 4 · Call" title="Agent calls MCP with a scoped, revocable token">
      <Card tone={cardTone} data-testid="alp-step-2">
        <p className="pu-status-line">
          <StatusChip tone="info">Live call</StatusChip>
          <StatusChip tone="neutral">Demo order data</StatusChip>
          <StatusChip tone={chip.tone}>{chip.word}</StatusChip>
        </p>
        <p className="pu-note">
          Calls the retail <code className="pu-mono">list_orders</code> tool through the same RFC
          8693 token-exchange + gateway path every chip click uses. The exchange and the gateway
          call are real; the orders it returns are seeded demo records.
        </p>
        <div className="pu-actions">
          <ActionButton
            isNext={isNext}
            data-testid="alp-call-orders"
            onClick={() => { if (!busy) run(); }}
            aria-disabled={busy || undefined}
          >
            {busy ? 'Calling…' : 'Call list_orders as agent'}
          </ActionButton>
        </div>
        {status === 'done' && (
          <>
            <div className="pu-actions" role="group" aria-label="Result view">
              <button
                type="button"
                className="pu-btn alp-toggle"
                aria-pressed={viewMode === 'form'}
                onClick={() => setViewMode('form')}
              >
                Pretty Form
              </button>
              <button
                type="button"
                className="pu-btn alp-toggle"
                aria-pressed={viewMode === 'raw'}
                onClick={() => setViewMode('raw')}
              >
                Raw JSON
              </button>
            </div>
            {viewMode === 'form' ? (
              <OrdersView orders={orders} />
            ) : (
              <pre className="alp-result" tabIndex={0} aria-label="Raw JSON result">{JSON.stringify(orders, null, 2)}</pre>
            )}
          </>
        )}
        <div role="status" aria-live="polite">
          {status === 'error' && <p className="alp-error" data-testid="alp-orders-error">{error}</p>}
        </div>
      </Card>
    </Section>
  );
}

function StepUpSlot({ isNext, onDone }) {
  const [phase, setPhase] = React.useState('idle'); // idle | checking-out | waiting-approval | approved | error
  const [message, setMessage] = React.useState('');
  const [engine, setEngine] = React.useState(null); // 'simulated' | 'pingone' once CIBA has started
  const timerRef = React.useRef(null);
  // Cleared on unmount: a poll fetch already in flight must not go on to retry the checkout, or schedule
  // another poll, once the user has left the page.
  const aliveRef = React.useRef(true);
  const abortRef = React.useRef(null);
  // The gateway-issued HITL challengeId from the first 428, threaded through
  // CIBA initiate and the retry — see postCheckout's _hitl_challenge_id note.
  const hitlChallengeIdRef = React.useRef(null);

  // Routed through callMcpTool (same as ScopedCallSlot's list_orders call above)
  // so this checkout shows up in the Token Chain rail / right-side agent panel
  // instead of running invisibly via a bare fetch.
  //
  // callMcpTool deliberately resolves (does not throw) on HITL 428 so the
  // banking agent can open a consent modal. This page has no modal — treat
  // those soft-success payloads as failed checkout, or we falsely show
  // "Checkout completed" when authorize still blocked the purchase.
  const postCheckout = React.useCallback(async (hitlChallengeId) => {
    try {
      const { result } = await callMcpTool(
        'checkout',
        {
          product: 'Headphones',
          amount: 600,
          // Same bridge AIAgent.js/demoAgentService.js use for every other CIBA
          // retry: without the ORIGINAL gateway challengeId echoed back here,
          // routes/ciba.js has nothing to mark approved, PingOne Agent Gateway's P1AZ
          // decision re-asks fresh on retry, and CIBA approval loops forever.
          ...(hitlChallengeId ? { _hitl_challenge_id: hitlChallengeId } : {}),
        },
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
            hitlChallengeId: result.hitlChallengeId || null,
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
          hitlChallengeId: err.hitlChallengeId || null,
          message: err.message || code || `HTTP ${err.statusCode || 500}`,
        },
      };
    }
  }, []);

  const pollCiba = React.useCallback((authReqId, intervalMs) => {
    timerRef.current = setTimeout(async () => {
      if (!aliveRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/auth/ciba/poll/${authReqId}`, { credentials: 'include', signal: controller.signal });
        if (!aliveRef.current) return;
        if (res.status === 403 || res.status === 404 || res.status === 410) {
          setPhase('error');
          setMessage('CIBA approval was denied or expired.');
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!aliveRef.current) return;
        if (data.status === 'approved') {
          setMessage('Approved — retrying checkout…');
          const retry = await postCheckout(hitlChallengeIdRef.current);
          if (!aliveRef.current) return;
          if (retry.ok) {
            setPhase('approved');
            setMessage('Checkout completed.');
            onDone();
          } else {
            setPhase('error');
            setMessage(retry.body.message || `Retry failed: HTTP ${retry.status}`);
          }
          return;
        }
        pollCiba(authReqId, intervalMs);
      } catch (err) {
        if (!aliveRef.current) return;
        setPhase('error');
        setMessage(err.message || 'CIBA polling failed');
      }
    }, intervalMs);
  }, [postCheckout, onDone]);

  const runCheckout = React.useCallback(async () => {
    setPhase('checking-out');
    setMessage('');
    setEngine(null);
    const { status, ok, body } = await postCheckout();
    if (!aliveRef.current) return;
    // Step-up and HITL both clear via CIBA approval (session stepUpVerified +
    // hitlVerified). Start CIBA for either 428 — otherwise a HITL-only gate
    // would fall through to a false "Checkout completed".
    const needsCiba =
      status === 428 &&
      (body.error === 'mcp_step_up_required' ||
        body.error === 'mcp_hitl_required' ||
        body.error === 'hitl_required');
    if (needsCiba) {
      hitlChallengeIdRef.current = body.hitlChallengeId || null;
      try {
        const initRes = await fetch('/api/auth/ciba/initiate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            binding_message: 'Approve your $600 headphones purchase',
            // Lets routes/ciba.js mark the gateway's ORIGINAL HITL challenge
            // approved via hitlServiceClient.respondToChallenge — otherwise
            // the retry below re-triggers a fresh, unapproved challenge.
            hitl_challenge_id: body.hitlChallengeId || undefined,
          }),
        });
        const { auth_req_id, interval, engine } = await initRes.json();
        if (!aliveRef.current) return;
        setPhase('waiting-approval');
        // initiate reports which engine answers: 'simulated' (the local backchannel, which auto-approves
        // after a few seconds, see docs/superpowers/plans/2026-07-20-ciba-real-platform-provisioning.md) or
        // 'pingone' (a real request the user approves). The message and chip say which, never assume.
        setEngine(engine || null);
        setMessage(approvalWaitMessage(engine, auth_req_id));
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
    onDone();
  }, [postCheckout, pollCiba, onDone]);

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const busy = phase === 'checking-out' || phase === 'waiting-approval';
  const chip = {
    idle: { tone: 'neutral', word: 'Not run' },
    'checking-out': { tone: 'info', word: 'Checking out' },
    'waiting-approval': { tone: 'warn', word: 'Waiting for approval' },
    approved: { tone: 'ok', word: 'Completed' },
    error: { tone: 'danger', word: 'Failed' },
  }[phase];
  const cardTone = phase === 'approved' ? 'ok' : phase === 'error' ? 'danger' : phase === 'waiting-approval' ? 'warn' : 'live';

  return (
    <Section id="alp-step-3" kicker="Step 3 of 4 · Step up" title="Step-up approval on a sensitive purchase">
      <Card tone={cardTone} data-testid="alp-step-3">
        <p className="pu-status-line">
          <StatusChip tone="neutral">Demo purchase</StatusChip>
          {engine === 'simulated' && <StatusChip tone="warn">Simulated approval</StatusChip>}
          {engine === 'pingone' && <StatusChip tone="info">PingOne CIBA</StatusChip>}
          <StatusChip tone={chip.tone}>{chip.word}</StatusChip>
        </p>
        <p className="pu-note">
          Checks out $600 of headphones with the same agent-scoped path — above
          the retail step-up threshold, so PingOne Authorize requires a CIBA
          step-up approval before the purchase completes. No money moves. Whether the approval
          is answered by PingOne or by a local simulation is reported by the server when the
          request starts, and the chip above says which.
        </p>
        <div className="pu-actions">
          <ActionButton
            isNext={isNext}
            data-testid="alp-checkout"
            onClick={() => { if (!busy) runCheckout(); }}
            aria-disabled={busy || undefined}
          >
            {busy ? 'Processing…' : 'Checkout $600 headphones'}
          </ActionButton>
        </div>
        <div role="status" aria-live="polite">
          {message && (
            <p className="alp-message" data-testid="alp-checkout-status">
              {phase === 'waiting-approval'
                ? (
                  <span className="alp-waiting">
                    <PingIdentitySpinner size={20} aria-hidden="true" />
                    <span>{message}</span>
                  </span>
                )
                : message}
            </p>
          )}
        </div>
      </Card>
    </Section>
  );
}

/**
 * Move keyboard focus into the kill-switch dialog (it portals to <body>, so Tab would not reach it).
 * Lands on Cancel: the safe default for a destructive dialog, one Tab from Confirm.
 */
function focusKillSwitchDialog() {
  const dialog = document.querySelector('[role="dialog"][aria-label^="Stop Agent"]');
  if (!dialog) return;
  const buttons = [...dialog.querySelectorAll('button:not([disabled])')];
  const target = buttons.find((b) => b.textContent.trim() === 'Cancel') || buttons[0];
  if (target) target.focus();
}

function RevokeSlot({ which, onFlow, flow }) {
  const [agentId, setAgentId] = React.useState(null);
  const [showModal, setShowModal] = React.useState(false);
  const [retryResult, setRetryResult] = React.useState('');
  const [reenableBusy, setReenableBusy] = React.useState(false);
  const revokeBtnRef = React.useRef(null);
  const wasOpen = React.useRef(false);
  const { revoked, scopeFull } = flow;

  React.useEffect(() => {
    getAgents()
      .then((data) => setAgentId(data?.live?.id || 'demo-agent'))
      .catch(() => setAgentId('demo-agent'));
  }, []);

  // Keyboard users: focus goes into the dialog on open and back to the Revoke button on close.
  React.useEffect(() => {
    if (showModal) {
      const t = setTimeout(focusKillSwitchDialog, 50);
      wasOpen.current = true;
      return () => clearTimeout(t);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      revokeBtnRef.current?.focus();
    }
    return undefined;
  }, [showModal]);

  const openModal = () => {
    setShowModal(true);
    onFlow({ modalOpen: true });
  };
  const closeModal = () => {
    setShowModal(false);
    onFlow({ modalOpen: false });
  };

  // Must forward the modal's scope. Omitting it lets the API default to
  // scope=full, which disables the PingOne agent apps for every user.
  const confirmRevoke = React.useCallback(async (id, reason, scope = 'instance') => {
    try {
      await apiClient.post(`/api/admin/agent/${id}/kill-switch`, { reason, scope });
    } catch (err) {
      // A 401 here is expected once the session dies mid-request — the
      // retry below is the real proof, not this call's own success. Any other
      // failure (500, 403, network) means the revoke did not register: say so,
      // keep the Revoke button live, and rethrow so the dialog stays open on
      // its own error with the Confirm button ready for a retry.
      const status = err?.response?.status ?? err?.status ?? err?.statusCode;
      if (status !== 401) {
        const why = status ? `HTTP ${status}` : (err?.message || 'request failed');
        setRetryResult(`Revoke failed (${why}) — the agent may not have been stopped. Try again.`);
        throw err instanceof Error ? err : new Error(`Revoke failed (${why})`);
      }
    }
    setRetryResult('');
    setShowModal(false);
    onFlow({ modalOpen: false, revoked: true, scopeFull: scope === 'full' });
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
  }, [onFlow]);

  const reenableAgent = React.useCallback(async () => {
    if (!agentId || reenableBusy) return;
    setReenableBusy(true);
    try {
      await apiClient.post(`/api/admin/agent/${agentId}/re-enable`, {});
      setRetryResult('Agent applications re-enabled — sign in again to continue the demo.');
      onFlow({ revoked: false, scopeFull: false });
    } catch (err) {
      setRetryResult(`Re-enable failed: ${err.message || 'request failed'}`);
    } finally {
      setReenableBusy(false);
    }
  }, [agentId, reenableBusy, onFlow]);

  const revokeDisabled = !agentId || revoked;
  const showReenable = revoked && scopeFull;

  return (
    <Section id="alp-step-4" kicker="Step 4 of 4 · Revoke" title="Self-service revoke">
      <Card tone={revoked ? 'warn' : 'danger'} data-testid="alp-step-4">
        <p className="pu-status-line">
          <StatusChip tone="danger">Real action</StatusChip>
          <StatusChip tone={revoked ? 'warn' : 'neutral'}>{revoked ? 'Revoked' : 'Not revoked'}</StatusChip>
        </p>
        <p className="pu-note">
          Revokes this agent's access via the same kill-switch the AI Control
          Plane page uses. This ends your own session — real kill-switch
          semantics, not a simulation. Prefer &quot;This instance only&quot; so
          the PingOne agent app stays enabled for the rest of the demo.
        </p>
        <div className="pu-actions">
          <ActionButton
            ref={revokeBtnRef}
            isNext={which === 'revoke'}
            data-testid="alp-revoke"
            onClick={() => { if (!revokeDisabled) openModal(); }}
            aria-disabled={revokeDisabled || undefined}
          >
            {revoked ? 'Revoked' : 'Revoke agent access'}
          </ActionButton>
          {showReenable && (
            <ActionButton
              isNext={which === 'reenable'}
              data-testid="alp-reenable"
              onClick={reenableAgent}
              aria-disabled={reenableBusy || undefined}
            >
              {reenableBusy ? 'Re-enabling…' : 'Re-enable agent apps'}
            </ActionButton>
          )}
        </div>
        <KillSwitchConfirmModal
          isOpen={showModal}
          agentId={agentId}
          onConfirm={confirmRevoke}
          onCancel={closeModal}
        />
        <div role="status" aria-live="polite">
          {retryResult && <p className="alp-message" data-testid="alp-revoke-status">{retryResult}</p>}
        </div>
        {revoked && (
          <p className="pu-actions">
            <a
              className="alp-link"
              href={`/audit?agentId=${agentId}`}
              target="_blank"
              rel="noreferrer"
            >
              View audit trail →
            </a>
            <a
              className="alp-link"
              href={`/api/control-plane/lifecycle-events?agentId=${agentId}`}
              target="_blank"
              rel="noreferrer"
            >
              View lifecycle export feed →
            </a>
          </p>
        )}
      </Card>
    </Section>
  );
}

