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

//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md): P2 banner first, P3 frame, P4 cards, P7 chips,
// P9 buttons, built on the shared primitives (components/pingUi, styles/ping-ui.css).
// This page keeps only the highlighted prompt, the findings table and the kind
// checklist in PrivilegePiiDetectionPage.css. The standalone shell bar is not
// added (the app has its own).

import { useMemo, useState } from 'react';
import PrivilegeLiveCheck from '../components/privilege/PrivilegeLiveCheck';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip,
} from '../components/pingUi';
import {
  PII_KINDS,
  PII_SAMPLES,
  PII_DEMO_NOTES,
} from '../config/privilegePiiKinds';
import { scan, annotate } from './privilegePiiScan';
import './PrivilegePiiDetectionPage.css';

const OUTCOME_LABEL = {
  block: { label: 'Block', tone: 'danger' },
  alert: { label: 'Alert', tone: 'warn' },
  sanitize: { label: 'Sanitize', tone: 'info' },
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
    <PingPage className="pii-page">
      <SimBanner data-testid="pii-banner">
        <strong>BROWSER-SIDE SCAN</strong> — the detectors on this page run in this browser, using the real
        patterns and checksums (Luhn, Verhoeff, mod-11) for the {PII_KINDS.length} of the platform's 23 kinds it
        can verify offline. Nothing you type is sent anywhere by the scan. The one real call is the check at the
        bottom: it goes through this machine's BFF to the Privilege AI Gateway and fetches a record; it does not
        run this scan.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="Personal data detection — 23 kinds"
        summary="Coverage went from 5 kinds to 23, each numeric kind checksum-validated. Detection is per kind; the graduated response is allow, alert, sanitize or block per kind."
      />
      <PageFrame>
        <Section
          id="pii-scan"
          kicker="1 · Scan a prompt"
          title="Detection per kind, with the checksum in the rule"
          lede="Pick a sample or paste your own prompt. Each match shows the policy outcome the platform would apply."
        >
          <CardGrid>
            <Card title="Prompt">
              <label className="pu-label" htmlFor="pii-sample">Sample</label>
              <select
                id="pii-sample"
                className="pu-select"
                value={sampleKey}
                onChange={(e) => { setSampleKey(e.target.value); setCustomText(''); }}
                data-testid="pii-sample"
              >
                {PII_SAMPLES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <label className="pu-label pii-gap" htmlFor="pii-custom">Or paste your own prompt</label>
              <textarea
                id="pii-custom"
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
              <p className="pu-note">{PII_DEMO_NOTES.ownFormats}</p>
            </Card>

            <Card title="Detections" tone={findings.length ? 'warn' : 'neutral'}>
              <p className="pu-status-line">
                <StatusChip tone={findings.length ? 'warn' : 'neutral'}>
                  {findings.length ? `${findings.length} found` : 'None found'}
                </StatusChip>
              </p>
              {findings.length ? (
                <div className="pii-table-wrap">
                  <table className="pii-table" data-testid="pii-findings">
                    <thead><tr><th scope="col">Kind</th><th scope="col">Match</th><th scope="col">Policy outcome</th></tr></thead>
                    <tbody>
                      {findings.map((f, i) => (
                        <tr key={`${f.kindId}-${i}`}>
                          <td data-label="Kind">{f.kindLabel}</td>
                          <td data-label="Match"><code className="pu-mono">{f.value}</code></td>
                          <td data-label="Policy outcome">
                            <StatusChip tone={OUTCOME_LABEL[f.outcome].tone}>{OUTCOME_LABEL[f.outcome].label}</StatusChip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="pu-note pu-empty" data-testid="pii-none">No detections. A checksum-invalid candidate is not reported — validation is part of the rule, not a post-filter.</p>
              )}
              <p className="pu-note">{PII_DEMO_NOTES.graduated}</p>
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="pii-kinds"
          kicker="2 · Catalog"
          title="Kinds in this page's catalog"
          lede={`The platform's full catalog is 23 kinds; this page runs the ${PII_KINDS.length} it can verify correctly offline, with real checksums (Luhn, Verhoeff, mod-11) where the platform applies them. Untick a kind to switch its detector off.`}
        >
          <CardGrid>
            {groups.map((g) => (
              <Card key={g} title={g} tone="neutral">
                {PII_KINDS.filter((k) => k.group === g).map((k) => (
                  <label key={k.id} className="pii-kind">
                    <input type="checkbox" checked={enabled.has(k.id)} onChange={() => toggleKind(k.id)} />
                    <span>{k.label}</span>
                    <span className="pii-kind-meta">{k.checksum ? 'checksum-validated' : 'pattern'}</span>
                  </label>
                ))}
              </Card>
            ))}
          </CardGrid>
        </Section>

        <Section id="pii-live" kicker="3 · Live check" title="Fetch a real record through the gateway">
          <Card tone="live">
            <p className="pu-status-line"><StatusChip tone="info">Live call</StatusChip> Not simulated: the verdict below comes from the gateway.</p>
            <PrivilegeLiveCheck
              tool="get_investment_transactions"
              args={{ subject: 'alice' }}
              label="Fetch a real record through the Privilege gateway"
              buttonClassName="pu-btn pu-btn--primary"
              statusChip
            />
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
