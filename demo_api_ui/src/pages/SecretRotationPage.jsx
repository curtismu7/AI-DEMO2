import React, { useCallback, useEffect, useRef, useState } from 'react';
import InspectorShell from '../components/shared/InspectorShell';
import DraggableModal from '../components/DraggableModal';
import apiClient from '../services/apiClient';
import './SecretRotationPage.css';

const POLL_MS = 2000;

// The API never returns the secret; a run's fingerprint (from its log's
// `fingerprint=` line) is the only way to verify a rotation without ever
// displaying the value.
function parseFingerprint(lines) {
  const line = lines.find((l) => l.includes('fingerprint=')) || '';
  return line.split('fingerprint=')[1] || '';
}

export default function SecretRotationPage() {
  const [apps, setApps] = useState([]);
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
      .then((r) => { if (!cancelled) setApps(r.data.apps || []); })
      .catch(() => { if (!cancelled) setApps([]); });
    return () => {
      cancelled = true;
      cancelledRef.current = true;
      clearTimeout(timer.current);
    };
  }, []);

  const poll = useCallback(async (runId) => {
    try {
      const { data } = await apiClient.get(`/api/admin/secret-rotation/runs/${runId}`);
      if (cancelledRef.current) return;
      setLines(data.lines || []);
      setStatus(data.status);
      if (data.status === 'running') {
        timer.current = setTimeout(() => {
          if (!cancelledRef.current) poll(runId);
        }, POLL_MS);
      }
    } catch (err) {
      if (cancelledRef.current) return;
      setStatus('error');
      setErrorMessage(err?.message || 'Unknown error');
    }
  }, []);

  function selectApp(a) {
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

  async function startRotation() {
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
      setArmed(false);
      setReason('');
      poll(data.runId);
    } catch (err) {
      if (cancelledRef.current) return;
      setArmed(false);
      setReason('');
      setStatus('error');
      setErrorMessage(err?.message || 'Unknown error');
    }
  }

  const fingerprint = parseFingerprint(lines);

  return (
    <>
      <InspectorShell
        title="Secret Rotation"
        left={(
          <ul className="sr-app-list">
            {apps.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => selectApp(a)}>{a.name}</button>
              </li>
            ))}
          </ul>
        )}
        middle={selected && (
          <div className="sr-detail">
            <h2>{selected.name}</h2>
            <p className="sr-meta">{selected.tokenEndpointAuthMethod}</p>
            <button type="button" className="sr-danger" onClick={() => setConfirming(true)}>
              Rotate secret
            </button>
            {status === 'running' && <p className="sr-result">Rotating…</p>}
            {/* The mask claims a secret exists — only a completed rotation
                earns it. An aborted run changed nothing at all. */}
            {status === 'done' && (
              <p className="sr-result">
                Secret: <code>••••••••</code>
                {fingerprint && <> · fingerprint <code>{fingerprint}</code></>}
              </p>
            )}
            {status === 'aborted' && (
              <p className="sr-error">Rotation refused — nothing was changed. See the log.</p>
            )}
            {status === 'failed' && (
              <p className="sr-error">Rotation failed after the secret was rotated. See the log.</p>
            )}
            {status === 'error' && (
              <p className="sr-error">Rotation status unknown: {errorMessage}</p>
            )}
          </div>
        )}
        right={<pre className="sr-log">{lines.join('\n')}</pre>}
      />
      {selected && (
        <DraggableModal
          isOpen={confirming}
          onClose={closeConfirm}
          title="Rotate this client secret?"
          footer={null}
        >
          <div className="dm-scroll">
            <p className="sr-warning">
              ⚠️ This cannot be undone. <strong>{selected.name}</strong>&apos;s current secret
              dies immediately, and every consumer fails until propagation completes.
            </p>
            <label htmlFor="sr-reason">Reason</label>
            <input id="sr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            {!armed ? (
              <button
                type="button"
                disabled={!reason.trim()}
                onClick={() => setArmed(true)}
              >
                I understand — arm rotation
              </button>
            ) : (
              <button type="button" className="sr-danger" onClick={startRotation}>
                Yes, rotate
              </button>
            )}
          </div>
        </DraggableModal>
      )}
    </>
  );
}
