// /secret-rotation: rotate the client secret of a PingOne application this demo stores a secret for.
//
// Honesty: nothing here is simulated. A rotation changes the real PingOne application and the vault entry through the
// BFF, and the old secret stops working at once. The secret is never returned; the run's fingerprint is the proof.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through the shared
// primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P6 inspector
// (the shared InspectorShell), P7 chips, P9 buttons. Skipped: P1 (the app has its own shell bar) and P8 (no diagram).
//
// P9, one primary per view state:
//   no application selected   no action exists, so no primary
//   application selected      "Rotate secret" is the primary
//   rotation running          "Rotate secret" stays the primary but is aria-disabled (it keeps focus; a second run would
//                             kill the new secret again), with the reason in the run status
//   confirm dialog open       the dialog's one control is the primary ("I understand - arm rotation", then "Yes, rotate",
//                             the same button node so focus stays on it); the page's button drops to a secondary
// The dialog is portalled outside .pu-page, so its buttons carry their own copy of the fixed Ping Red primary.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import InspectorShell from '../components/shared/InspectorShell';
import DraggableModal from '../components/DraggableModal';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from '../components/pingUi';
import apiClient from '../services/apiClient';
import './SecretRotationPage.css';

const POLL_MS = 2000;
const MIN_COL_WIDTH = 60;
const DEFAULT_COL_WIDTHS = { select: 40, app: 320, auth: 160 };

// The API never returns the secret; a run's fingerprint (from its log's
// `fingerprint=` line) is the only way to verify a rotation without ever
// displaying the value.
function parseFingerprint(lines) {
  const line = lines.find((l) => l.includes('fingerprint=')) || '';
  return line.split('fingerprint=')[1] || '';
}

// What the run's status means on screen: the chip word, its tone (green only for a run that reports verified success)
// and the card edge. `idle` is a neutral "nothing run yet".
const RUN_VIEW = {
  idle: { word: 'Not run', tone: 'neutral', card: 'neutral' },
  running: { word: 'Running', tone: 'info', card: 'live' },
  done: { word: 'Rotated', tone: 'ok', card: 'ok' },
  aborted: { word: 'Refused', tone: 'warn', card: 'warn' },
  failed: { word: 'Failed', tone: 'danger', card: 'danger' },
  error: { word: 'Unknown', tone: 'warn', card: 'warn' },
};

export default function SecretRotationPage() {
  const [apps, setApps] = useState([]);
  // loading | ready | error: an empty list and a failed list are different things to tell the operator.
  const [appsState, setAppsState] = useState('loading');
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS);
  // Table cells don't support native CSS `resize` reliably, so a column drag
  // adjusts a <col> width directly (table-layout: fixed ties every row's
  // width to it) instead of adding a resize-observer dependency for three
  // columns.
  const resizeState = useRef(null);

  const onColResizeMove = useCallback((e) => {
    const state = resizeState.current;
    if (!state) return;
    const delta = e.clientX - state.startX;
    setColWidths((w) => ({ ...w, [state.col]: Math.max(MIN_COL_WIDTH, state.startWidth + delta) }));
  }, []);

  const onColResizeUp = useCallback(() => {
    resizeState.current = null;
    document.removeEventListener('mousemove', onColResizeMove);
    document.removeEventListener('mouseup', onColResizeUp);
  }, [onColResizeMove]);

  const startColResize = useCallback((col) => (e) => {
    e.preventDefault();
    resizeState.current = { col, startX: e.clientX, startWidth: colWidths[col] };
    document.addEventListener('mousemove', onColResizeMove);
    document.addEventListener('mouseup', onColResizeUp);
  }, [colWidths, onColResizeMove, onColResizeUp]);

  const [selected, setSelected] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [armed, setArmed] = useState(false);
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const timer = useRef(null);
  // Set true on unmount; checked before every setState/re-poll so an
  // in-flight request or a pending poll timeout can't act on an unmounted
  // page (same pattern as KillSwitchConfirmModal.jsx).
  const cancelledRef = useRef(false);
  // Bumped each time a different application is selected. A run's POST or poll that lands after that must not write its
  // log or fingerprint under the newly selected application.
  const viewTokenRef = useRef(0);

  useEffect(() => {
    // A LOCAL `cancelled`, not `cancelledRef` — React StrictMode double-invokes
    // this effect in dev (mount, synthetic unmount, remount). `cancelledRef` is
    // a ref at component scope, so its cleanup-set `true` from the first,
    // discarded invocation survives into the second, real one and is never
    // reset — every fetch after that point is silently ignored by both `then`
    // handlers, forever, on every single mount. A `let` declared inside the
    // effect body is a fresh binding each time the effect re-runs, exactly
    // like KillSwitchConfirmModal.jsx's `activeRuns` fetch, which this was
    // meant to copy. See memory: StrictMode defeats useRef first-run guards.
    // Also revive cancelledRef for this run: StrictMode's synthetic unmount
    // (from the PREVIOUS invocation of this same effect) already set it true
    // via the cleanup below, and nothing else ever resets it back — without
    // this, poll()/startRotation() would stay permanently blocked too, since
    // they gate on this same ref for the rest of the component's real life.
    cancelledRef.current = false;
    let cancelled = false;
    apiClient.get('/api/admin/secret-rotation/apps')
      .then((r) => {
        if (cancelled) return;
        setApps(r.data.apps || []);
        setAppsState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setApps([]);
        setAppsState('error');
      });
    return () => {
      cancelled = true;
      cancelledRef.current = true;
      clearTimeout(timer.current);
    };
  }, []);

  const poll = useCallback(async (runId, token) => {
    try {
      const { data } = await apiClient.get(`/api/admin/secret-rotation/runs/${runId}`);
      if (cancelledRef.current || viewTokenRef.current !== token) return;
      setLines(data.lines || []);
      setStatus(data.status);
      if (data.status === 'running') {
        timer.current = setTimeout(() => {
          if (!cancelledRef.current && viewTokenRef.current === token) poll(runId, token);
        }, POLL_MS);
      }
    } catch (err) {
      if (cancelledRef.current || viewTokenRef.current !== token) return;
      setStatus('error');
      setErrorMessage(err?.message || 'Unknown error');
    }
  }, []);

  function selectApp(a) {
    // The row click, its radio and its name button all land here: re-choosing the current application must not wipe
    // its run.
    if (selected?.id === a.id) return;
    viewTokenRef.current += 1;
    setSelected(a);
    setArmed(false);
    setReason('');
    // Clear the previous app's run too, or its fingerprint and log render
    // under the newly selected app's heading.
    clearTimeout(timer.current);
    setLines([]);
    setStatus('idle');
    setErrorMessage('');
  }

  function closeConfirm() {
    setConfirming(false);
    setArmed(false);
    setReason('');
  }

  function openConfirm() {
    // aria-disabled keeps the button focusable while a run is going; the click does nothing then.
    if (status === 'running') return;
    setConfirming(true);
  }

  async function startRotation() {
    const token = viewTokenRef.current;
    setConfirming(false);
    setStatus('running');
    setErrorMessage('');
    try {
      const { data } = await apiClient.post('/api/admin/secret-rotation/start', {
        appId: selected.id,
        // Server-derived by /apps — never guessed here. A key invented from the
        // display name can never match a real vault entry.
        vaultKey: selected.vaultKey,
        // Both false: the rotation runs inside the BFF container, which ships
        // no docker CLI and no kubectl. The run log prints the exact host
        // command to finish the job instead.
        restart: false,
        k8s: false,
        reason,
      });
      if (viewTokenRef.current !== token) return; // another application was selected meanwhile
      setArmed(false);
      setReason('');
      poll(data.runId, token);
    } catch (err) {
      if (cancelledRef.current || viewTokenRef.current !== token) return;
      setArmed(false);
      setReason('');
      setStatus('error');
      setErrorMessage(err?.message || 'Unknown error');
    }
  }

  const fingerprint = parseFingerprint(lines);

  let inspectorStatus = 'Loading applications…';
  if (appsState === 'error') inspectorStatus = 'Application list unavailable';
  else if (appsState === 'ready') inspectorStatus = `${apps.length} rotatable ${apps.length === 1 ? 'application' : 'applications'}`;

  return (
    <PingPage className="srot-page">
      <SimBanner data-testid="sr-banner">
        <strong>LIVE OPERATION</strong> — nothing here is simulated. Rotating changes the real PingOne application&apos;s
        client secret and its vault entry through this machine&apos;s BFF; the old secret stops working at once and this
        cannot be undone. The secret is never shown, only a fingerprint. The run restarts nothing: once it has rotated the
        secret, its log prints the host command that does. This page needs a signed-in session.
      </SimBanner>
      <PageHeader
        eyebrow="Config · Operations"
        title="Secret Rotation"
        summary="Rotate the client secret of a PingOne application this demo stores a secret for. Pick an application, give a reason, arm the rotation, then confirm; the run log and fingerprint show what happened."
      />
      <PageFrame>
        <Section
          id="sr-rotate"
          kicker="1 · Rotate a client secret"
          title="Pick an application, confirm, then check the fingerprint"
        >
          <InspectorShell
            title="Rotation console"
            statusOn={appsState === 'ready'}
            statusText={inspectorStatus}
            fullHeight={false}
            titleLevel={2}
            left={(
              <AppTable
                apps={apps}
                appsState={appsState}
                selected={selected}
                onSelect={selectApp}
                colWidths={colWidths}
                startColResize={startColResize}
              />
            )}
            middle={(
              <RunDetail
                selected={selected}
                status={status}
                errorMessage={errorMessage}
                fingerprint={fingerprint}
                confirming={confirming}
                onRotate={openConfirm}
              />
            )}
            right={<RunLog lines={lines} />}
          />
        </Section>
      </PageFrame>
      {selected && (
        <DraggableModal
          isOpen={confirming}
          onClose={closeConfirm}
          title="Rotate this client secret?"
          footer={null}
        >
          <div className="dm-scroll srot-modal">
            <p className="srot-warning">
              {selected.isWorker ? (
                <>
                  ⚠️ This cannot be undone. <strong>{selected.name}</strong>&apos;s current secret
                  dies immediately — and because this is the credential the whole demo uses to
                  authenticate to PingOne&apos;s Management API, every PingOne-dependent request
                  in the demo fails, not just this app&apos;s, until demo-api-server is restarted.
                </>
              ) : (
                <>
                  ⚠️ This cannot be undone. <strong>{selected.name}</strong>&apos;s current secret
                  dies immediately, and every consumer fails until propagation completes.
                </>
              )}
            </p>
            <label htmlFor="sr-reason" className="srot-modal-label">Reason</label>
            <input
              id="sr-reason"
              className="srot-modal-input"
              data-autofocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="srot-modal-hint">Written to the run log. Arming needs a reason.</p>
            {!armed ? (
              <button
                type="button"
                className="srot-modal-btn srot-modal-btn--confirm"
                disabled={!reason.trim()}
                onClick={() => setArmed(true)}
              >
                I understand — arm rotation
              </button>
            ) : (
              <button type="button" className="srot-modal-btn srot-modal-btn--confirm" onClick={startRotation}>
                Yes, rotate
              </button>
            )}
          </div>
        </DraggableModal>
      )}
    </PingPage>
  );
}

// Below the page so the page reads banner first in source order; function declarations hoist.
function AppTable({ apps, appsState, selected, onSelect, colWidths, startColResize }) {
  return (
    <>
      <div className="inspector-shell-tree-header">Rotatable applications</div>
      <div
        className="srot-app-table-wrap"
        role="region"
        aria-label="Rotatable applications"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
        tabIndex={0}
      >
        <table className="srot-app-table">
          <colgroup>
            <col style={{ width: colWidths.select }} />
            <col style={{ width: colWidths.app }} />
            <col style={{ width: colWidths.auth }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="srot-app-table-select-col">
                <span className="srot-visually-hidden">Select</span>
                <span
                  className="srot-col-resizer"
                  data-testid="sr-col-resizer-select"
                  onMouseDown={startColResize('select')}
                />
              </th>
              <th scope="col">
                Application
                <span
                  className="srot-col-resizer"
                  data-testid="sr-col-resizer-app"
                  onMouseDown={startColResize('app')}
                />
              </th>
              <th scope="col">
                Auth method
                <span
                  className="srot-col-resizer"
                  data-testid="sr-col-resizer-auth"
                  onMouseDown={startColResize('auth')}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => {
              const isSelected = selected?.id === a.id;
              return (
                <tr
                  key={a.id}
                  className={isSelected ? 'sr-row-selected' : ''}
                  onClick={() => onSelect(a)}
                >
                  <td>
                    <input
                      type="radio"
                      name="sr-app"
                      aria-label={`Select ${a.name} to rotate`}
                      checked={isSelected}
                      onChange={() => onSelect(a)}
                    />
                  </td>
                  <td>
                    <button type="button" className="srot-row-name" onClick={() => onSelect(a)}>
                      {a.name}
                    </button>
                    <div className="srot-row-clientid">{a.clientId}</div>
                  </td>
                  <td className="srot-meta">{a.tokenEndpointAuthMethod}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Mounted from the first render so a later change of text is announced. */}
      <p className="pu-empty pu-note srot-list-note" role="status">
        {appsState === 'loading' && 'Loading the application list from the BFF…'}
        {appsState === 'error' && 'The application list could not be loaded from the BFF, so nothing can be rotated. Reload the page to try again.'}
        {appsState === 'ready' && apps.length === 0 && 'No application has a rotatable vault entry.'}
      </p>
    </>
  );
}

function RunDetail({ selected, status, errorMessage, fingerprint, confirming, onRotate }) {
  if (!selected) {
    return (
      <div className="srot-detail">
        <p className="pu-empty pu-note">Select an application to rotate its client secret.</p>
      </div>
    );
  }
  const run = RUN_VIEW[status] || RUN_VIEW.idle;
  const running = status === 'running';
  return (
    <div className="srot-detail">
      <Card title={selected.name}>
        <KvList
          items={[
            { label: 'Auth method', value: selected.tokenEndpointAuthMethod },
            { label: 'Vault entry', value: selected.vaultKey, mono: true },
            {
              label: 'Kind',
              value: selected.isWorker
                ? <StatusChip tone="warn">Worker credential</StatusChip>
                : 'Application',
            },
          ]}
        />
        <div className="pu-actions">
          <button
            type="button"
            className={confirming ? 'pu-btn' : 'pu-btn pu-btn--primary'}
            aria-disabled={running || undefined}
            aria-describedby={running ? 'sr-run-status' : undefined}
            onClick={onRotate}
          >
            Rotate secret
          </button>
        </div>
      </Card>
      <Card title="Rotation run" tone={run.card} data-testid="sr-run-card">
        {/* Always mounted, so each change of status is announced. */}
        <div className="pu-status-line" role="status" id="sr-run-status" data-testid="sr-run-status">
          <StatusChip tone={run.tone}>{run.word}</StatusChip>
          <span>
            {status === 'idle' && 'No rotation has been run for this application in this view.'}
            {running && 'Rotating… the old secret stops working as soon as PingOne accepts the change. A second run is blocked until this one ends.'}
            {status === 'done' && 'The run reported success: rotated in PingOne, written to the vault and checked by the run. The secret is not shown. The log prints the host command that restarts the services.'}
            {status === 'aborted' && 'Rotation refused — nothing was changed. See the log.'}
            {status === 'failed' && 'Rotation did not finish cleanly. The secret may already have been rotated. See the log.'}
            {status === 'error' && `Rotation status unknown: ${errorMessage}`}
          </span>
        </div>
        {/* The mask claims a secret exists, so only a completed rotation earns it. */}
        {status === 'done' && (
          <KvList
            items={[
              { label: 'Secret', value: '••••••••' },
              ...(fingerprint ? [{ label: 'Fingerprint', value: fingerprint, mono: true }] : []),
            ]}
          />
        )}
      </Card>
    </div>
  );
}

function RunLog({ lines }) {
  return (
    <div
      className="srot-log-wrap"
      role="region"
      aria-label="Rotation log"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
      tabIndex={0}
    >
      <pre className="srot-log">{lines.length ? lines.join('\n') : 'The log of the run appears here.'}</pre>
    </div>
  );
}
