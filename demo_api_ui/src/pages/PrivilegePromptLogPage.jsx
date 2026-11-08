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
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md) through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv,
// P7 chips, P9 buttons. This page keeps only its record table and the
// sealed/decrypted block in PrivilegePromptLogPage.css.

import { useMemo, useState } from 'react';
import PrivilegeLiveCheck from '../components/privilege/PrivilegeLiveCheck';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from '../components/pingUi';
import { SEALED_PROMPT_RECORDS, SEALED_DEMO } from '../config/privilegePlatformUpdateDemos';
import './PrivilegePromptLogPage.css';

// The decision word is always shown; the tone only adds colour to it (P7).
const DECISION_TONE = {
  allow: 'ok',
  block: 'danger',
  sanitize: 'warn',
};

function DecisionChip({ decision }) {
  return <StatusChip tone={DECISION_TONE[decision] ?? 'neutral'}>{decision}</StatusChip>;
}

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

  const isOpen = unsealedId === record.id;

  return (
    <PingPage className="ppl-page">
      <SimBanner data-testid="ppl-banner">
        <strong>SAMPLE RECORDS</strong> — the prompt records, the sealed content and the decrypted text on this
        page are sample data, and no encryption runs here: any non-empty key opens the sample. Nothing you type
        leaves this browser. The one real call is the gateway check at the bottom: it goes through this
        machine&apos;s BFF to the Privilege AI Gateway.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="Prompt Logging, encrypted to you"
        summary="Prompts and responses retained under a key only you hold. Privilege seals content with your public key; your private key opens a record in the console, at the moment you open it, and never leaves your browser."
      />
      <PageFrame>
        <Section
          id="ppl-records-h"
          kicker="1 · Find, then open"
          title="Sealed until you open it"
          lede="A record you never open is never decrypted anywhere. Searchable detail — who ran it, which agent, what was detected, what was decided — stays in the clear so you can find the record first."
        >
          <div className="ppl-layout">
            <Card tone="neutral">
              <div className="ppl-table-wrap">
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
                        <td data-label="Record">{r.id}</td>
                        <td data-label="Agent">{r.agent}</td>
                        <td data-label="Detected">{r.category}</td>
                        <td data-label="Decision"><DecisionChip decision={r.decision} /></td>
                        <td data-label="Content" className="ppl-sealed-cell">{unsealedId === r.id ? 'decrypted in browser' : r.sealed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="pu-note">Select a row to see its detail. Selecting another record closes any record you had open.</p>
            </Card>

            <Card title={`Record ${record.id}`} tone={isOpen ? 'ok' : undefined} data-testid="ppl-detail">
              <p className="pu-status-line">
                {isOpen
                  ? <StatusChip tone="ok">Decrypted</StatusChip>
                  : <StatusChip tone="neutral">Sealed</StatusChip>}
                {isOpen ? 'Open in this browser only.' : 'Content is sealed to your public key.'}
              </p>
              <KvList
                items={[
                  { label: 'Agent', value: record.agent },
                  { label: 'Application', value: record.application },
                  { label: 'Who', value: record.who },
                  { label: 'Detected', value: record.category },
                  { label: 'Decision', value: <DecisionChip decision={record.decision} /> },
                  { label: 'At', value: record.at, mono: true },
                ]}
              />
              {isOpen ? (
                <div className="ppl-plaintext" data-testid="ppl-plaintext">
                  <strong>Decrypted (in this browser only)</strong>
                  <p>{SEALED_DEMO.plaintextByRecord[record.id] ?? 'Sample plaintext: the prompt and response this record sealed. In the product this came from the sealed blob, decrypted with the private key you entered, and it is never stored opened.'}</p>
                  <button type="button" className="pu-btn" onClick={closeRecord}>Close and forget the key</button>
                </div>
              ) : (
                <div className="ppl-sealed" data-testid="ppl-sealed">
                  <p className="pu-mono">{record.sealed}</p>
                  <label className="pu-label" htmlFor="ppl-privkey">Private key (stays in this browser)</label>
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
                  <button type="button" className="pu-btn pu-btn--primary" onClick={openRecord} data-testid="ppl-open">Open this record</button>
                </div>
              )}
            </Card>
          </div>
        </Section>

        <Section id="ppl-live-h" kicker="2 · Live check" title="Read what the gateway's own log holds">
          <Card tone="live">
            <p className="pu-status-line"><StatusChip tone="info">Live call</StatusChip> Not simulated: the verdict below comes from the gateway.</p>
            <PrivilegeLiveCheck
              tool="sensitive_customer_identity"
              args={{ subject: 'alice' }}
              label="See what the gateway's own log would hold (live read)"
              buttonClassName="pu-btn"
              statusChip
            />
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
