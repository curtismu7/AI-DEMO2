// /privilege-pii-detection — Personal data detection, 23 kinds (Platform
// Update, page 13, AIGuard "Personal data, your way").
//
// Coverage went from 5 kinds to 23 — national identifiers (UK NINO, India
// Aadhaar and PAN, Canada SIN, Australia TFN, NZ IRD), financial, health and
// contact details — each numeric kind checksum-validated. Detection is per
// kind, your own formats paste in unchanged in gitleaks rule format, and the
// same rules run on LLM, MCP, A2A and coding-agent traffic alike.
//
// Honesty: the detectors below run in this browser and are a faithful subset —
// real patterns and real checksums (Luhn, Verhoeff, mod-11 weightings) for the
// kinds this page covers, matching the platform's documented gate: a match
// that fails its checksum is not reported. 23 kinds minus the checksummed and
// contact kinds shown here = the platform's full catalog; this page shows the
// ones it can verify correctly offline.

import { useMemo, useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import {
  PII_KINDS,
  PII_SAMPLES,
  PII_DEMO_NOTES,
} from '../config/privilegePiiKinds';
import { scan, annotate } from './privilegePiiScan';
import './PrivilegePiiDetectionPage.css';

const OUTCOME_LABEL = {
  block: { label: 'Block', cls: 'p pii-outcome--block' },
  alert: { label: 'Alert', cls: 'pii-outcome--alert' },
  sanitize: { label: 'Sanitize', cls: 'pii-outcome--sanitize' },
};


export default function PrivilegePiiDetectionPage() {
  const [sampleKey, setSampleKey] = useState(PII_SAMPLES[0].key);
  const [customText, setCustomText] = useState('');
  const [enabled, setEnabled] = useState(() => new Set(PII_KINDS.map((k) => k.id)));

  const sample = PII_SAMPLES.find((s) => s.key === sampleKey) ?? PII_SAMPLES[0];
  const text = customText.trim() ? customText : sample.text;

  const activeKinds = useMemo(() => PII_KINDS.filter((k) => enabled.has(k.id)), [enabled]);
  const findings = useMemo(() => scan(text, activeKinds), [text, activeKinds]);
  const parts = useMemo(() => annotate(text, findings), [text, findings]);

  const toggleKind = (id) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const groups = [...new Set(PII_KINDS.map((k) => k.group))];

  return (
    <div className="pii-page">
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="Personal data detection — 23 kinds"
        summary="Coverage went from 5 kinds to 23, each numeric kind checksum-validated. Detection is per kind; the graduated response is allow, alert, sanitize or block per kind."
      />
      <div className="pii-body">
        <div className="pii-grid">
          <section className="pii-panel" aria-labelledby="pii-scan">
            <h2 id="pii-scan">Scan a prompt</h2>
            <label className="pii-label" htmlFor="pii-sample">Sample</label>
            <select id="pii-sample" className="pii-select" value={sampleKey} onChange={(e) => { setSampleKey(e.target.value); setCustomText(''); }} data-testid="pii-sample">
              {PII_SAMPLES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <textarea
              className="pii-textarea"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="…or paste your own prompt here. Your own formats paste in unchanged in gitleaks rule format."
              rows={4}
              data-testid="pii-custom"
            />
            <div className="pii-highlight" data-testid="pii-highlight" aria-label="Prompt with detections marked">
              {parts.map((p, i) => (
                p.kindLabel
                  ? <mark key={i} className={`pii-mark pii-mark--${p.outcome}`} title={p.kindLabel}>{p.text}</mark>
                  : <span key={i}>{p.text}</span>
              ))}
            </div>
            {findings.length ? (
              <table className="pii-findings" data-testid="pii-findings">
                <thead><tr><th scope="col">Kind</th><th scope="col">Match</th><th scope="col">Policy outcome</th></tr></thead>
                <tbody>
                  {findings.map((f, i) => (
                    <tr key={`${f.kindId}-${i}`}>
                      <td>{f.kindLabel}</td>
                      <td><code>{f.value}</code></td>
                      <td><span className={`pii-outcome ${OUTCOME_LABEL[f.outcome].cls}`}>{OUTCOME_LABEL[f.outcome].label}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="pii-muted" data-testid="pii-none">No detections. A checksum-invalid candidate is not reported — validation is part of the rule, not a post-filter.</p>
            )}
            <p className="pii-muted">{PII_DEMO_NOTES.ownFormats}</p>
            <p className="pii-muted">{PII_DEMO_NOTES.graduated}</p>
          </section>

          <section className="pii-panel" aria-labelledby="pii-kinds">
            <h2 id="pii-kinds">Kinds in this page's catalog</h2>
            <p className="pii-muted">
              The platform's full catalog is 23 kinds; this page runs the {PII_KINDS.length} it can verify
              correctly offline, with real checksums (Luhn, Verhoeff, mod-11) where the platform applies them.
            </p>
            {groups.map((g) => (
              <div key={g} className="pii-group">
                <h3>{g}</h3>
                {PII_KINDS.filter((k) => k.group === g).map((k) => (
                  <label key={k.id} className="pii-kind">
                    <input type="checkbox" checked={enabled.has(k.id)} onChange={() => toggleKind(k.id)} />
                    <span>{k.label}</span>
                    <span className="pii-kind-meta">{k.checksum ? 'checksum-validated' : 'pattern'}</span>
                  </label>
                ))}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
