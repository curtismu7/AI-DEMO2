import { Section, LessonLayout, Lede, OnThisRun, Status } from "../components/lesson";
import VerifyCard from "../components/VerifyCard";
import "./PingOneVerifyRecognizePage.css";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "verify", label: "PingOne Verify" },
  { id: "recognize", label: "PingOne Recognize" },
  { id: "architecture", label: "How the flow works" },
];

export default function PingOneVerifyRecognizePage() {
  return (
    <LessonLayout
      pageClassName="pvr-page"
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
        <div className="pvr-hero">
          <span className="pvr-hero__mark" aria-hidden="true">ID</span>
          <div>
            <p className="pvr-hero__eyebrow">Customer identity journey</p>
            <p className="pvr-hero__summary">Proof identity first. Add biometric verification only when the server can validate the result.</p>
          </div>
        </div>
        <ol className="pvr-steps" aria-label="Identity journey">
          <li className="pvr-step">
            <span className="pvr-step__number">01</span>
            <h3>Start Verify</h3>
            <p>The signed-in customer opens PingOne's hosted verification experience.</p>
          </li>
          <li className="pvr-step">
            <span className="pvr-step__number">02</span>
            <h3>Confirm status</h3>
            <p>The BFF reads the transaction from PingOne and reports its authoritative status.</p>
          </li>
          <li className="pvr-step pvr-step--gated">
            <span className="pvr-step__number">03</span>
            <h3>Recognize</h3>
            <p>Biometric enrollment and authentication stay unavailable until the integration gate is cleared.</p>
          </li>
        </ol>
      </Section>

      <Section id="verify" title="PingOne Verify">
        <Lede>
          Start an identity proofing transaction when the app, PingOne environment, and customer account are eligible. The browser receives a hosted handoff URL; PingOne API credentials and transaction ownership remain on the BFF.
        </Lede>
        <div className="pvr-verify-layout">
          <VerifyCard showDisabled />
          <aside className="pvr-note">
            <h3>What counts as complete</h3>
            <p>Only a PingOne transaction status of <code>SUCCESS</code>, read by the BFF for the signed-in customer, is shown as completed identity proofing.</p>
            <p>A browser return, pending result, manual approval, or unrecognized status does not mark the customer verified.</p>
          </aside>
        </div>
      </Section>

      <Section id="recognize" title="PingOne Recognize">
        <Lede>
          Recognize is intended to provide biometric enrollment and authentication after identity proofing. The web SDK runs in the browser, while the BFF must validate the signed operation result before the app records success.
        </Lede>
        <div className="pvr-gate">
          <div className="pvr-gate__header">
            <span className="pvr-gate__label">Integration status</span>
            <span className="pvr-gate__badge">Gated</span>
          </div>
          <h3>Recognize is not enabled in this app yet</h3>
          <p>The tenant configuration and the signed-result and operation-binding contract still need confirmation. A successful Verify transaction does not enable Recognize, and this page does not request camera access or accept a browser-only success signal.</p>
          <ul>
            <li>Confirm the non-production Recognize tenant and approved Web SDK package.</li>
            <li>Confirm server-side signature, user, operation, and replay validation.</li>
            <li>Enable an enrollment or authentication action only after those checks are in place.</li>
          </ul>
        </div>
      </Section>

      <Section id="architecture" title="How the flow works">
        <div className="pvr-architecture">
          <article className="pvr-path">
            <p className="pvr-path__eyebrow">Active when configured</p>
            <h3>PingOne Verify</h3>
            <ol>
              <li>React asks the authenticated BFF to create a transaction.</li>
              <li>The BFF calls PingOne and records which customer owns the transaction.</li>
              <li>After hosted proofing, the BFF reads PingOne status and returns the result.</li>
            </ol>
          </article>
          <article className="pvr-path pvr-path--gated">
            <p className="pvr-path__eyebrow">Not enabled</p>
            <h3>PingOne Recognize</h3>
            <ol>
              <li>The Web SDK would capture the biometric operation after explicit user action.</li>
              <li>The browser would submit the signed result to the BFF.</li>
              <li>The BFF must validate the user, operation, signature, expiry, and one-time use.</li>
            </ol>
          </article>
        </div>
        <OnThisRun title="Trust boundary">
          <p><Status ok>Verify result is BFF checked</Status> The UI displays the provider status returned by the authenticated API. It cannot set the verification result itself.</p>
          <p><Status ok={false}>Recognize result validation is gated</Status> No biometric operation is treated as successful until server-side validation is implemented and configured.</p>
        </OnThisRun>
      </Section>
    </LessonLayout>
  );
}
