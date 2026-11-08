// banking_api_ui/src/components/TransactionConsentPage.js
//
// /transaction-consent. Two modes:
//   - live: `?challenge=` is present, so this is a real CIBA push deep link and the consent modal opens.
//   - simulate: no challenge, so the page runs a mock CIBA request through the BFF and answers it on a mock phone.
//
// Simulate mode follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md)
// through the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame,
// P4 cards, P5 kv, P7 chips with words, P9 buttons. P9's "exactly one primary per view" is read per view state:
//   picker   -> "Simulate" on the first scenario (the standard transfer, the recommended start);
//   running  -> no primary on the page while the mock phone is open (the decision is made on the phone, which
//               is a device, not a page control); "Open mock phone" is the primary once the phone is closed;
//   answered -> "Pick another scenario" (the only action that advances).
// Live mode renders the real consent modal and no page chrome, so it has no banner.
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import SignInPrompt from './SignInPrompt';
import TransactionConsentModal from './TransactionConsentModal';
import ConsentMockPhoneFlow from './ConsentMockPhoneFlow';
import EmbeddedFlowDiagram from './EmbeddedFlowDiagram';
import PageHeader from './common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from './pingUi';
import { CONSENT_MOCK_DIAGRAM } from '../config/consentMockPhoneDiagram';
import './TransactionConsentPage.css';

/**
 * Simulated consent scenario presets. `chip` is the word on the card's status chip (never colour alone).
 */
const SIMULATE_SCENARIOS = [
  {
    id: 'standard-transfer',
    label: 'Standard Transfer ($500)',
    chip: { tone: 'neutral', word: 'Standard' },
    snapshot: { amount: 500, type: 'transfer', description: 'Monthly rent payment' },
  },
  {
    id: 'high-value',
    label: 'High-Value Transfer ($15,000)',
    chip: { tone: 'warn', word: 'High value' },
    snapshot: { amount: 15000, type: 'transfer', description: 'Investment portfolio transfer' },
  },
  {
    id: 'withdrawal',
    label: 'ATM Withdrawal ($200)',
    chip: { tone: 'neutral', word: 'Standard' },
    snapshot: { amount: 200, type: 'withdrawal', description: 'Cash withdrawal' },
  },
  {
    id: 'agent-initiated',
    label: 'AI Agent-Initiated ($2,500)',
    chip: { tone: 'info', word: 'Agent-initiated' },
    snapshot: { amount: 2500, type: 'transfer', description: 'Agent: pay utility bill' },
  },
];

/**
 * Route wrapper for deep links: `/transaction-consent?challenge=…` opens the consent modal.
 * Without a challenge, shows simulate mode instead of redirecting away.
 */
export default function TransactionConsentPage({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const challengeId = searchParams.get('challenge');
  const restore = location.state?.restore;
  const [simulating, setSimulating] = useState(null);
  const [lastScenarioId, setLastScenarioId] = useState(null);

  const homePath = user?.role === 'admin' ? '/admin' : '/dashboard';

  if (!user) {
    // CIBA push deep-links land here signed out — show the page and ask,
    // never dump on home. (return_to is a bare path; the ?challenge= param
    // does not survive login — the push notification link remains the way back.)
    return <SignInPrompt message="Sign in to review this transfer approval." />;
  }

  // Live mode: real challenge from CIBA push
  if (challengeId) {
    return (
      <TransactionConsentModal
        open
        challengeId={challengeId}
        user={user}
        onClose={() => navigate(homePath, { replace: true })}
        onTransactionSuccess={(msg) => navigate(homePath, { state: { transactionSuccess: msg } })}
        onDeclinedConfirmed={() => navigate(homePath, { state: { restore, consentDeclined: true } })}
      />
    );
  }

  const start = (scenario) => {
    setLastScenarioId(scenario.id);
    setSimulating(scenario);
  };

  // Simulate mode: a mock CIBA request answered on the mock phone
  return (
    <PingPage className="tc-page">
      <SimBanner data-testid="tc-banner">
        <strong>SIMULATED</strong> — there is no challenge ID in this link, so nothing here is a real approval.
        The CIBA request, the push, the mock phone and your tap on it are all simulated: PingOne is not called,
        no token is issued and no money moves. What is real: your browser talks to this machine&apos;s BFF,
        which holds the mock request and records the protocol trace you see. A real approval arrives by a
        push link that carries <code>?challenge=</code>.
      </SimBanner>
      <PageHeader
        eyebrow="Delegation and consent · Transaction consent"
        title="Transaction Consent — Simulate"
        summary="A high-value transaction pauses for the user's approval on their own device. Pick a scenario: the BFF starts a mock CIBA request, the mock phone gets the push, and your tap on it is the decision."
      />
      <PageFrame>
        {simulating ? (
          <ConsentMockPhoneFlow pingUi scenario={simulating} onDone={() => setSimulating(null)} />
        ) : (
          <SimulateLanding onStartSimulation={start} focusId={lastScenarioId} />
        )}
      </PageFrame>
    </PingPage>
  );
}

/**
 * Simulate mode landing, shown when no ?challenge= is present.
 * Lets the user pick a scenario and run a mock CIBA request through the BFF.
 * The diagram's own Simulate/Next buttons are demoted to secondaries in TransactionConsentPage.css so the
 * picker has a single primary.
 */
function SimulateLanding({ onStartSimulation, focusId }) {
  const startRefs = useRef({});
  // Back from a run: put focus on the scenario that was just run instead of dropping it to the page.
  useEffect(() => {
    if (focusId) startRefs.current[focusId]?.focus();
  }, [focusId]);

  return (
    <>
      <Section
        id="tc-scenarios-h"
        kicker="1 · Pick a scenario"
        title="Which transaction needs approval?"
        lede="Each scenario starts a mock CIBA request for the signed-in user. Nothing is sent to PingOne and no money moves."
      >
        <CardGrid>
          {SIMULATE_SCENARIOS.map((s, i) => (
            <Card key={s.id} title={s.label} data-testid={`tc-scenario-${s.id}`}>
              <p className="pu-status-line">
                <StatusChip tone={s.chip.tone}>{s.chip.word}</StatusChip>
              </p>
              <KvList
                items={[
                  { label: 'Type', value: s.snapshot.type },
                  { label: 'Amount', value: `$${Number(s.snapshot.amount).toLocaleString()}` },
                  { label: 'Memo', value: s.snapshot.description },
                ]}
              />
              <div className="pu-actions">
                <button
                  type="button"
                  ref={(el) => { startRefs.current[s.id] = el; }}
                  className={i === 0 ? 'pu-btn pu-btn--primary' : 'pu-btn'}
                  aria-label={`Simulate ${s.label}`}
                  data-testid={`tc-start-${s.id}`}
                  onClick={() => onStartSimulation(s)}
                >
                  Simulate
                </button>
              </div>
            </Card>
          ))}
        </CardGrid>
      </Section>

      <Section
        id="tc-real-h"
        kicker="2 · In production"
        title="How the real flow differs"
        lede="This page normally activates from a CIBA push notification that carries a challenge ID. None of the steps below run here."
      >
        <CardGrid>
          <Card tone="neutral" title="When a transaction needs step-up">
            <p className="pu-note">
              When a high-value transaction triggers a step-up requirement, PingOne sends a CIBA
              (Client-Initiated Backchannel Authentication) push to the user&apos;s device. The user opens
              this page via the push link containing a challenge ID, reviews the transaction details, and
              approves or denies.
            </p>
          </Card>
          <Card tone="neutral" title="The CIBA consent flow">
            <ol className="tc-steps">
              <li>User (or AI agent) initiates a transaction that exceeds the authorization threshold</li>
              <li>PingOne Authorize returns a step-up obligation (CIBA consent required)</li>
              <li>BFF calls PingOne CIBA endpoint — sends push notification to user&apos;s device</li>
              <li>User opens this page via the deep link (<code>/transaction-consent?challenge=...</code>) or answers on the device</li>
              <li>User reviews transaction details and approves or denies</li>
              <li>PingOne completes the CIBA flow — transaction proceeds or is blocked</li>
            </ol>
          </Card>
        </CardGrid>
      </Section>

      <Section id="tc-diagram-h" kicker="3 · The exchange" title="Who talks to whom">
        <EmbeddedFlowDiagram
          config={CONSENT_MOCK_DIAGRAM}
          title="Simulated CIBA exchange"
          lede="Simulate mode keeps the whole CIBA exchange between your browser, the BFF and a mock phone; a real run swaps in PingOne and a deep link."
          ariaLabel="Transaction consent mock CIBA flow"
          testId="tc-diagram"
          pingStyle
        />
      </Section>
    </>
  );
}
