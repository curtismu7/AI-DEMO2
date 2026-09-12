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
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);

  useEffect(() => {
    apiClient.get('/api/admin/secret-rotation/apps')
      .then((r) => setApps(r.data.apps || []))
      .catch(() => setApps([]));
    return () => clearTimeout(timer.current);
  }, []);

  const poll = useCallback(async (runId) => {
    const { data } = await apiClient.get(`/api/admin/secret-rotation/runs/${runId}`);
    setLines(data.lines || []);
    setStatus(data.status);
    if (data.status === 'running') timer.current = setTimeout(() => poll(runId), POLL_MS);
  }, []);

  function closeConfirm() {
    setConfirming(false);
    setReason('');
  }

  async function startRotation() {
    setConfirming(false);
    setStatus('running');
    const { data } = await apiClient.post('/api/admin/secret-rotation/start', {
      appId: selected.id,
      vaultKey: selected.vaultKey || `${selected.name.toUpperCase().replace(/\W+/g, '_')}_CLIENT_SECRET`,
      restart: true,
      k8s: false,
      reason,
    });
    setReason('');
    poll(data.runId);
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
                <button type="button" onClick={() => setSelected(a)}>{a.name}</button>
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
            {status !== 'idle' && (
              <p className="sr-result">
                Secret: <code>••••••••</code>
                {fingerprint && <> · fingerprint <code>{fingerprint}</code></>}
              </p>
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
            <button type="button" className="sr-danger" onClick={startRotation}>
              Yes, rotate
            </button>
          </div>
        </DraggableModal>
      )}
    </>
  );
}
