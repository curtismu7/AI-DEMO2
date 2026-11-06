// /privilege-prompt-log — Prompt Logging, encrypted to your key (Platform
// Update, page 13/14, Agent Insights "Prompts").
//
// The prompt and response record: content is sealed with a public key the
// tenant supplied; only the private key — entered in the console at the moment
// a record is opened — decrypts it. Privilege never holds the private key, so
// neither an operator nor anyone who reaches the underlying store can read the
// prompts. The searchable detail around each record stays in the clear so the
// one record you need can be found before decrypting.
//
// Honesty: the records are sample metadata, and the "decrypted" content shown
// after the private key is entered is a labelled sample — no real sealed
// ciphertext exists here and no crypto runs in this page. The point the page
// makes is the state machine: sealed until you open it, decrypted only in the
// browser, never stored opened.

import { useMemo, useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import { SEALED_PROMPT_RECORDS, SEALED_DEMO } from '../config/privilegePlatformUpdateDemos';
import './PrivilegePromptLogPage.css';

const DECISION_CLASS = {
  allow: 'ppl-decision--allow',
  block: 'ppl-decision--block',
  sanitize: 'ppl-decision--sanitize',
};

export default function PrivilegePromptLogPage() {
  const [selectedId, setSelectedId] = useState(SEALED_PROMPT_RECORDS[0]?.id ?? '');
  const [privateKey, setPrivateKey] = useState('');
  const [unsealedId, setUnsealedId] = useState(null);
  const [keyError, setKeyError] = useState('');

  const record = useMemo(
    () => SEALED_PROMPT_RECORDS.find((r) => r.id === selectedId) ?? SEALED_PROMPT_RECORDS[0],
    [selectedId],
  );

  const openRecord = () => {
    // In the product the private key is held in the browser only and decrypted
    // content is never persisted. Here: any non-empty key "opens" the sample.
    if (!privateKey.trim()) {
      setKeyError('Enter the private key that pairs with the sealed public key. It never leaves this browser.');
      return;
    }
    setKeyError('');
    setUnsealedId(record.id);
  };

  const closeRecord = () => {
    setUnsealedId(null);
    setPrivateKey('');
    setKeyError('');
  };

  return (
    <div className="ppl-page">
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="Prompt Logging, encrypted to you"
        summary="Prompts and responses retained under a key only you hold. Privilege seals content with your public key; your private key opens a record in the console, at the moment you open it, and never leaves your browser."
      />
      <div className="ppl-body">
        <p className="ppl-banner">
          A record you never open is never decrypted anywhere. Searchable detail — who ran it, which agent,
          what was detected, what was decided — stays in the clear so you can find the record first.
        </p>
        <div className="ppl-layout">
          <table className="ppl-table" data-testid="ppl-records">
            <thead>
              <tr><th scope="col">Record</th><th scope="col">Agent</th><th scope="col">Detected</th><th scope="col">Decision</th><th scope="col">Content</th></tr>
            </thead>
            <tbody>
              {SEALED_PROMPT_RECORDS.map((r) => (
                <tr
                  key={r.id}
                  className={r.id === selectedId ? 'ppl-row--active' : ''}
                  onClick={() => { setSelectedId(r.id); setUnsealedId(null); }}
                >
                  <td>{r.id}</td>
                  <td>{r.agent}</td>
                  <td>{r.category}</td>
                  <td><span className={`ppl-decision ${DECISION_CLASS[r.decision] ?? ''}`}>{r.decision}</span></td>
                  <td className="ppl-sealed-cell">{unsealedId === r.id ? 'decrypted in browser' : r.sealed}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <aside className="ppl-detail" data-testid="ppl-detail">
            <h2>Record {record.id}</h2>
            <dl className="ppl-meta">
              <div><dt>Agent</dt><dd>{record.agent}</dd></div>
              <div><dt>Application</dt><dd>{record.application}</dd></div>
              <div><dt>Who</dt><dd>{record.who}</dd></div>
              <div><dt>Detected</dt><dd>{record.category}</dd></div>
              <div><dt>Decision</dt><dd>{record.decision}</dd></div>
              <div><dt>At</dt><dd>{record.at}</dd></div>
            </dl>
            {unsealedId === record.id ? (
              <div className="ppl-plaintext" data-testid="ppl-plaintext">
                <strong>Decrypted (in this browser only)</strong>
                <p>{SEALED_DEMO.plaintextByRecord[record.id] ?? 'Sample plaintext: the prompt and response this record sealed. In the product this came from the sealed blob, decrypted with the private key you entered, and it is never stored opened.'}</p>
                <button type="button" className="ppl-btn" onClick={closeRecord}>Close and forget the key</button>
              </div>
            ) : (
              <div className="ppl-sealed" data-testid="ppl-sealed">
                <p>{record.sealed}</p>
                <label className="ppl-label" htmlFor="ppl-privkey">Private key (stays in this browser)</label>
                <input
                  id="ppl-privkey"
                  type="password"
                  className="ppl-input"
                  value={privateKey}
                  onChange={(e) => { setPrivateKey(e.target.value); setKeyError(''); }}
                  placeholder="paste the private half of your key pair"
                  autoComplete="off"
                />
                {keyError && <p className="ppl-error" role="alert">{keyError}</p>}
                <button type="button" className="ppl-btn" onClick={openRecord} data-testid="ppl-open">Open this record</button>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
