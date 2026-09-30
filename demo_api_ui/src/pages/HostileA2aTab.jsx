// demo_api_ui/src/pages/HostileA2aTab.jsx
//
// The "Malicious A2A" tab on /llm-gateway: fetch a LIVE A2A Agent Card over the
// wire (through the BFF relay /api/privilege-a2a/scan-card, so there is no CORS
// or handshake problem) from a deliberately hostile A2A specialist
// (standalone/hostile-a2a-agent), then scan it client-side and show the poison.
//
// Honesty rule (same family as HostileMcpTab): the poison is in the Agent Card
// METADATA. A2A discovery does not inspect it — Privilege displays the card
// verbatim in its Agent Card tab (inventory only, no per-skill filtering). The
// defense is a scanner in front of the consumer, which is what this tab runs.
import { useState } from 'react';
import { scanAgentCard } from '../utils/mcpScanner';
import './HostileA2aTab.css';

const SCAN_ENDPOINT = '/api/privilege-a2a/scan-card';
// The hostile A2A agent's well-known card. Default targets a local instance
// (run standalone/hostile-a2a-agent, or point at any A2A card URL you can reach).
const DEFAULT_CARD_URL = 'http://host.docker.internal:8898/.well-known/agent-card.json';

export default function HostileA2aTab() {
  const [url, setUrl] = useState(DEFAULT_CARD_URL);
  const [card, setCard] = useState(null);
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchAndScan = async () => {
    setBusy(true);
    setError('');
    setCard(null);
    setFindings(null);
    try {
      const res = await fetch(SCAN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCard(data.card);
      setFindings(scanAgentCard(data.card));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ha2">
      <header className="ha2-bar">
        <div>
          <h1>Malicious A2A</h1>
          <p className="ha2-storyline">
            A hostile agent hides instructions in its <strong>Agent Card</strong> — the description a
            delegating agent reads, and its skill descriptions. A2A discovery never inspects that
            text, so the poison arrives verbatim. This tab fetches the <strong>live</strong> card over
            the wire and scans it the way a defense in front of the agent would.
          </p>
        </div>
      </header>

      <section className="ha2-run">
        <label className="ha2-label" htmlFor="ha2-url">Agent Card URL</label>
        <div className="ha2-run-row">
          <input
            id="ha2-url"
            className="ha2-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            placeholder="https://…/.well-known/agent-card.json"
          />
          <button type="button" className="ha2-btn ha2-btn--danger" disabled={busy || !url.trim()} onClick={fetchAndScan}>
            {busy ? 'Fetching…' : 'Fetch & scan the live card'}
          </button>
        </div>
        <p className="ha2-note">
          Fetched through the BFF (<code>/api/privilege-a2a/scan-card</code>). Point it at
          <code> standalone/hostile-a2a-agent</code> (run it locally) or any A2A agent's card URL.
        </p>
      </section>

      {error ? <p className="ha2-error" role="alert">{error}</p> : null}

      {card ? (
        <div className="ha2-body">
          <section className="ha2-pane" aria-label="The live Agent Card">
            <h2 className="ha2-k">What a delegating agent reads</h2>
            <div className="ha2-field"><span className="ha2-field__k">Name</span><span className="ha2-field__v">{card.name || '—'}</span></div>
            <div className="ha2-field"><span className="ha2-field__k">Protocol</span><span className="ha2-field__v">{card.protocolVersion || '—'} · {card.preferredTransport || '—'}</span></div>
            <div className="ha2-desc">
              <span className="ha2-field__k">Description</span>
              <pre className="ha2-pre">{card.description || '—'}</pre>
            </div>
            {Array.isArray(card.skills) && card.skills.length ? (
              <div className="ha2-skills">
                <span className="ha2-field__k">Skills ({card.skills.length})</span>
                {card.skills.map((s) => (
                  <div key={s.id || s.name} className="ha2-skill">
                    <div className="ha2-skill__name">{s.name || s.id}</div>
                    <pre className="ha2-pre">{s.description || '—'}</pre>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="ha2-pane" aria-label="Scanner verdict">
            <h2 className="ha2-k">Scanner verdict</h2>
            {findings && findings.length === 0 ? (
              <div className="ha2-clean">✓ No poisoned metadata found</div>
            ) : (
              <>
                <ul className="ha2-findings">
                  {(findings || []).map((f, i) => (
                    <li key={i} className={`ha2-finding ha2-kind-${f.kind}`}>
                      <span className="ha2-finding__head">⚠ <b>{f.tool}</b> — {f.kind}</span>
                      <span className="ha2-finding__detail">{f.detail}</span>
                    </li>
                  ))}
                </ul>
                <p className="ha2-verdict">
                  {findings.length} finding(s). This card reaches a delegating agent unfiltered — do not trust this specialist.
                </p>
              </>
            )}
            <p className="ha2-priv">
              🛡 Registered as a Privilege <strong>Remote Agent (a2a)</strong>, this same card is shown
              <strong> verbatim</strong> in the console&rsquo;s <strong>Agent Card</strong> tab —
              &ldquo;inventory only, access is granted to the Remote Agent as a whole, not per skill.&rdquo;
              Privilege discovers and displays the poison; it does not filter it. The scanner is the
              defense that sits in front of the agent.
            </p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
