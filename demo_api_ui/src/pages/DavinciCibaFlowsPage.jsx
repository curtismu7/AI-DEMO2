import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from '../components/pingUi';
import './DavinciCibaFlowsPage.css';

/**
 * Explainer: the DaVinci configuration in this demo — CIBA flows, login
 * widget/SDK policies, and the orchestration showcase. Claims mirror
 * demo_api_server/config/davinci.js, docs/ciba-real-provisioning-todo.md,
 * scripts/davinci-brand-ciba-flows.mjs and docs/DAVINCI_ORCHESTRATION_STATUS.md.
 *
 * Layout follows the standalone Ping UI Standard on the shared primitives
 * (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame,
 * P4 cards, P5 kv, P7 chips. Skipped: P6 (not an inspector), P8 (no diagram).
 * The standalone shell bar is not added (the app has its own).
 *
 * P9: this page runs nothing, so it has no primary button in any state. Its one
 * control is a link to another page, styled as a secondary (.pu-btn).
 *
 * Chips: every chip is neutral. The page checks nothing, so no card may read as
 * a verified result; the chip names the kind of thing the card describes.
 */

const SECTIONS = [
  {
    id: 'dv-ciba',
    kicker: '1 · CIBA',
    title: 'CIBA flows (human approves on their device)',
    rows: [
      {
        name: 'Two imported flows: "email only" and "SMS only"',
        kind: 'DaVinci flows',
        what: 'The marketplace PingOne CIBA sample flow, imported into DaVinci with the PingOne Flow and CIBA Flow toggles enabled in Flow Settings, saved and deployed. Each delivery channel is a separate flow so the CIBA app’s flow policy can pin exactly one channel.',
        facts: [
          { label: 'Flows', value: 'email only, SMS only' },
          { label: 'Flow Settings', value: 'PingOne Flow + CIBA Flow on' },
        ],
      },
      {
        name: 'Flow policy on the CIBA app',
        kind: 'Flow policy',
        what: 'A PingOne Flow Policy ("CIBA Step-Up Policy") is attached to the Demo AI App - CIBA application: show only CIBA flows, Latest Version, weight 100. The CIBA grant on the app is PingFederate/PingOne CIBA with delivery mode POLL. In this demo the approval request is a mock phone or email; only in a real DaVinci deployment does the human see it as a request on their own MFA device.',
        facts: [
          { label: 'Policy', value: 'CIBA Step-Up Policy' },
          { label: 'Weight', value: '100' },
          { label: 'Delivery mode', value: 'POLL', mono: true },
        ],
      },
      {
        name: 'Per-vertical branding of the consent screens',
        kind: 'Branding script',
        what: 'scripts/davinci-brand-ciba-flows.mjs patches the consent/approved/declined screens of both flows. The BFF prefixes the CIBA binding_message with a 2-char vertical code (config/cibaVerticalCodes.js); a browser script inside each screen reads the code and applies that vertical’s name, tagline, logo and colors from the manifest, with a luminance check so text on the brand color stays readable. Runs with --out to preview, --apply to PUT the flows as DRAFTS (a human clicks Deploy in DaVinci). Each flow is backed up before touching it.',
        facts: [
          { label: 'Script', value: 'scripts/davinci-brand-ciba-flows.mjs', mono: true },
          { label: 'Preview', value: '--out', mono: true },
          { label: 'Apply', value: '--apply (flows PUT as drafts)', mono: true },
        ],
      },
    ],
  },
  {
    id: 'dv-login',
    kicker: '2 · Login',
    title: 'Login: widget and Orchestration SDK',
    rows: [
      {
        name: 'Widget policy (PINGONE_DAVINCI_LOGIN_POLICY_ID_V1)',
        kind: 'Widget lane',
        what: 'A non-PingOne DaVinci flow with a widget success node; the embedded widget invocation (skRenderScreen) needs companyId + this per-version policy id, and the DaVinci API key is sent as X-SK-API-KEY when minting an SDK token server-side.',
        facts: [
          { label: 'Setting', value: 'PINGONE_DAVINCI_LOGIN_POLICY_ID_V1', mono: true },
          { label: 'Header', value: 'X-SK-API-KEY', mono: true },
        ],
      },
      {
        name: 'Orchestration SDK policy (PINGONE_DAVINCI_SDK_POLICY_ID)',
        kind: 'SDK lane',
        what: 'A different DaVinci application and a PingOne redirect flow policy selected via pi.flow acr_values — the SDK lane and the widget lane deliberately use different apps/policies.',
        facts: [{ label: 'Setting', value: 'PINGONE_DAVINCI_SDK_POLICY_ID', mono: true }],
      },
      {
        name: 'The vault gotcha',
        kind: 'Vault',
        what: 'The DaVinci API key lives in the vault; configStore mirrors only two named secrets into process.env, so reading process.env made a correctly-vaulted key invisible and the route answered davinci_not_configured forever. config/davinci.js reads the key through configStore.getEffective (env first, vault fallback) — a plain .env value still wins for local runs.',
        facts: [
          { label: 'Symptom', value: 'davinci_not_configured', mono: true },
          { label: 'Read through', value: 'configStore.getEffective', mono: true },
        ],
      },
    ],
  },
  {
    id: 'dv-orchestration',
    kicker: '3 · Orchestration',
    title: 'Orchestration showcase (flag off by default)',
    rows: [
      {
        name: 'The flow',
        kind: 'Flag off by default',
        what: 'Transaction step-up decided by a DaVinci flow: PingOne SSO → Protect risk score → branch → MFA + a Generic HTTP connector alerting a fraud queue → Authorize → webhook back to POST /webhook/davinci (DAVINCI_WEBHOOK_URL or derived from the public app URL).',
        facts: [
          { label: 'Webhook', value: 'POST /webhook/davinci', mono: true },
          { label: 'Webhook URL', value: 'DAVINCI_WEBHOOK_URL', mono: true },
        ],
      },
      {
        name: 'Fail-closed to the hand-coded path',
        kind: 'Fallback',
        what: 'Any DaVinci error falls back to the BFF’s hand-coded OTP/MFA step-up flow — the showcase never blocks a transaction on DaVinci availability. Flow definitions on file: docs/Super_Banking_Transaction_Authorization_DaVinci.json and Super_Banking_MCP_Tool_Authorization_DaVinci.json; status in docs/DAVINCI_ORCHESTRATION_STATUS.md.',
        facts: [{ label: 'Status', value: 'docs/DAVINCI_ORCHESTRATION_STATUS.md', mono: true }],
      },
    ],
  },
];

export default function DavinciCibaFlowsPage() {
  return (
    <PingPage className="dv-ciba" data-testid="davinci-ciba-flows">
      <SimBanner data-testid="dv-ciba-banner">
        <strong>REFERENCE, NOTHING RUNS HERE</strong> — this page describes how DaVinci is set up for this demo, written
        from the repo&rsquo;s config and scripts. It does not call DaVinci or PingOne and does not read the live
        tenant, so it cannot show that a flow is deployed today. CIBA approval in this demo is a mock phone or email;
        this page sends none.
      </SimBanner>
      <PageHeader
        eyebrow="DaVinci · what we configured"
        title="DaVinci CIBA flows & orchestration"
        summary="The DaVinci side of the demo: the CIBA approval flows behind UC22/UC-LEARN14, the login widget and Orchestration SDK policies, and the flag-gated orchestration showcase that lets a DaVinci flow decide transaction step-up."
        actions={
          <Link className="pu-btn" to="/pingfederate-davinci-kit">
            PF DaVinci kit
          </Link>
        }
      />
      <PageFrame>
        {SECTIONS.map((s) => (
          <Section key={s.id} id={s.id} kicker={s.kicker} title={s.title}>
            <CardGrid>
              {s.rows.map((r) => (
                <Card key={r.name} title={r.name} data-testid="dv-ciba-card">
                  <div className="pu-status-line">
                    <StatusChip tone="neutral">{r.kind}</StatusChip>
                  </div>
                  <p className="pu-note">{r.what}</p>
                  <KvList items={r.facts} />
                </Card>
              ))}
            </CardGrid>
          </Section>
        ))}
      </PageFrame>
    </PingPage>
  );
}
