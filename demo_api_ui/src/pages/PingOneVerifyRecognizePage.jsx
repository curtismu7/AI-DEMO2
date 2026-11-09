// PingOne Verify & Recognize (/ping-products/verify-recognize): a product explainer with one live card.
//
// Honesty: the text is an explanation. The "Identity verification" card (components/VerifyCard) is the only live
// part: it asks this app's BFF whether PingOne Verify is available, starts a hosted Verify transaction only
// on a click, and shows the status the BFF reads back from PingOne. Nothing on the page is simulated, and Recognize is
// not enabled: no camera, no browser-only success signal.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) on the shared
// primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P4 cards, P5 key-value, P7 chips,
// P9 buttons. The lesson shell (LessonLayout: title band + section nav) stays as the page frame, as on /ai-products.
// Skipped: P3 PageFrame (the lesson shell is the frame), P6 (not an inspector), P8 (no diagram; the flow is two
// numbered lists). The standalone shell bar is not added (the app has its own).
//
// P9, one primary per view state. The only action is inside the Identity verification card (VerifyCard ping):
//   signed out / disabled / not eligible / checking / in progress : no action, so no primary
//   ready (available, nothing started)                             : "Verify identity" is the one primary
//   finished but not SUCCESS (failed, expired, not confirmed)      : "Start a new verification" is the one primary
//   SUCCESS                                                        : no action, so no primary
// The lesson header's "Dark mode" and "Export PDF" are secondary controls (lesson.css), never a primary.
import { Section, LessonLayout, Lede } from "../components/lesson";
import VerifyCard from "../components/VerifyCard";
import { PingPage, SimBanner, CardGrid, Card, StatusChip, KvList } from "../components/pingUi";
import "./PingOneVerifyRecognizePage.css";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "verify", label: "PingOne Verify" },
  { id: "recognize", label: "PingOne Recognize" },
  { id: "architecture", label: "How the flow works" },
];

// What the Identity verification card shows for each status the BFF can return (components/VerifyCard).
const STATUS_RULES = [
  { label: "SUCCESS", value: "Verified. The only status shown as completed identity proofing." },
  { label: "FAIL, EXPIRED", value: "Not verified. A new verification can be started." },
  { label: "APPROVED_MANUALLY, APPROVED_NO_REQUEST, NOT_REQUIRED, UNKNOWN", value: "Not confirmed. Does not complete automated identity proofing." },
  { label: "Anything else (pending)", value: "In progress. Not verified until PingOne reports SUCCESS." },
];

export default function PingOneVerifyRecognizePage() {
  return (
    <PingPage className="pvr-page">
      <SimBanner data-testid="pvr-banner">
        <strong>EXPLAINER WITH ONE LIVE CARD</strong> — the text is an explanation. The Identity verification card is
        live: it asks this app's BFF whether PingOne Verify is available to the signed-in account, starts a hosted
        PingOne Verify transaction only when you click, and shows the status the BFF reads back from PingOne. Nothing
        here is simulated. PingOne Recognize is not enabled: this page captures no biometrics and takes no
        browser-only success signal.
      </SimBanner>
      <LessonLayout
        pageClassName="pvr-lesson-page"
        title="PingOne Verify & Recognize"
        subtitle="Identity proofing and biometric verification for the customer journey."
        sections={SECTIONS}
        storageKey="pingone-verify-recognize-sections"
        printExclude={[]}
      >
        <Section id="overview" title="Two distinct identity checks">
          <Lede>
            PingOne Verify checks identity evidence through a Ping-hosted proofing flow. PingOne Recognize can add biometric enrollment and authentication. In this app, Verify status is checked by the BFF; Recognize remains gated until its tenant setup and signed-result validation are confirmed.
          </Lede>
          <Card className="pvr-hero" data-testid="pvr-hero">
            <span className="pvr-hero__mark" aria-hidden="true">ID</span>
            <div>
              <p className="pvr-hero__eyebrow">Customer identity journey</p>
              <p className="pvr-hero__summary">Proof identity first. Add biometric verification only when the server can validate the result.</p>
            </div>
          </Card>
          <ol className="pu-card-grid pvr-steps" aria-label="Identity journey">
            <li>
              <Card className="pvr-step" title="1 · Start Verify">
                <p className="pu-status-line"><StatusChip tone="info">Active when configured</StatusChip></p>
                <p className="pu-note">The signed-in customer opens PingOne's hosted verification experience.</p>
              </Card>
            </li>
            <li>
              <Card className="pvr-step" title="2 · Confirm status">
                <p className="pu-status-line"><StatusChip tone="info">Active when configured</StatusChip></p>
                <p className="pu-note">The BFF reads the transaction from PingOne and reports its authoritative status.</p>
              </Card>
            </li>
            <li>
              <Card className="pvr-step" tone="warn" title="3 · Recognize">
                <p className="pu-status-line"><StatusChip tone="warn">Gated</StatusChip></p>
                <p className="pu-note">Biometric enrollment and authentication stay unavailable until the integration gate is cleared.</p>
              </Card>
            </li>
          </ol>
        </Section>

        <Section id="verify" title="PingOne Verify">
          <Lede>
            Start an identity proofing transaction when the app, PingOne environment, and customer account are eligible. The browser receives a hosted handoff URL; PingOne API credentials and transaction ownership remain on the BFF.
          </Lede>
          <CardGrid>
            <VerifyCard showDisabled ping />
            <Card tone="neutral" title="What counts as complete" data-testid="pvr-complete">
              <p className="pu-note">Only a PingOne transaction status of <code>SUCCESS</code>, read by the BFF for the signed-in customer, is shown as completed identity proofing. A browser return, pending result, manual approval, or unrecognized status does not mark the customer verified.</p>
              <KvList items={STATUS_RULES} />
            </Card>
          </CardGrid>
        </Section>

        <Section id="recognize" title="PingOne Recognize">
          <Lede>
            Recognize is intended to provide biometric enrollment and authentication after identity proofing. The web SDK runs in the browser, while the BFF must validate the signed operation result before the app records success.
          </Lede>
          <Card tone="warn" title="Recognize is not enabled in this app yet" data-testid="pvr-gate">
            <p className="pu-status-line"><StatusChip tone="warn">Gated</StatusChip>Integration status</p>
            <p className="pu-note">The tenant configuration and the signed-result and operation-binding contract still need confirmation. A successful Verify transaction does not enable Recognize, and this page does not request camera access or accept a browser-only success signal.</p>
            <ul className="pvr-list">
              <li>Confirm the non-production Recognize tenant and approved Web SDK package.</li>
              <li>Confirm server-side signature, user, operation, and replay validation.</li>
              <li>Enable an enrollment or authentication action only after those checks are in place.</li>
            </ul>
          </Card>
        </Section>

        <Section id="architecture" title="How the flow works">
          <CardGrid>
            <Card tone="live" title="PingOne Verify" data-testid="pvr-path-verify">
              <p className="pu-status-line"><StatusChip tone="info">Active when configured</StatusChip></p>
              <ol className="pvr-list">
                <li>React asks the authenticated BFF to create a transaction.</li>
                <li>The BFF calls PingOne and records which customer owns the transaction.</li>
                <li>After hosted proofing, the BFF reads PingOne status and returns the result.</li>
              </ol>
            </Card>
            <Card tone="warn" title="PingOne Recognize" data-testid="pvr-path-recognize">
              <p className="pu-status-line"><StatusChip tone="warn">Not enabled</StatusChip></p>
              <ol className="pvr-list">
                <li>The Web SDK would capture the biometric operation after explicit user action.</li>
                <li>The browser would submit the signed result to the BFF.</li>
                <li>The BFF must validate the user, operation, signature, expiry, and one-time use.</li>
              </ol>
            </Card>
          </CardGrid>
          <Card tone="neutral" title="Trust boundary" data-testid="pvr-trust">
            <p className="pu-status-line"><StatusChip tone="info">By design</StatusChip>The Verify result is BFF checked. The UI displays the provider status returned by the authenticated API; it cannot set the verification result itself.</p>
            <p className="pu-status-line"><StatusChip tone="warn">Gated</StatusChip>Recognize result validation is not implemented. No biometric operation is treated as successful until server-side validation is built and configured.</p>
          </Card>
        </Section>
      </LessonLayout>
    </PingPage>
  );
}
