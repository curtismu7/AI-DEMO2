import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import './DavinciCibaFlowsPage.css';

/**
 * Explainer: the DaVinci configuration in this demo — CIBA flows, login
 * widget/SDK policies, and the orchestration showcase. Claims mirror
 * demo_api_server/config/davinci.js, docs/ciba-real-provisioning-todo.md,
 * scripts/davinci-brand-ciba-flows.mjs and docs/DAVINCI_ORCHESTRATION_STATUS.md.
 */

const SECTIONS = [
  {
    id: 'ciba',
    title: 'CIBA flows (human approves on their device)',
    rows: [
      {
        name: 'Two imported flows: "email only" and "SMS only"',
        what: 'The marketplace PingOne CIBA sample flow, imported into DaVinci with the PingOne Flow and CIBA Flow toggles enabled in Flow Settings, saved and deployed. Each delivery channel is a separate flow so the CIBA app\u2019s flow policy can pin exactly one channel.',
      },
      {
        name: 'Flow policy on the CIBA app',
        what: 'A PingOne Flow Policy ("CIBA Step-Up Policy") is attached to the Demo AI App - CIBA application: show only CIBA flows, Latest Version, weight 100. The CIBA grant on the app is PingFederate/PingOne CIBA with delivery mode POLL; the human sees the approval request on their MFA device.',
      },
      {
        name: 'Per-vertical branding of the consent screens',
        what: 'scripts/davinci-brand-ciba-flows.mjs patches the consent/approved/declined screens of both flows. The BFF prefixes the CIBA binding_message with a 2-char vertical code (config/cibaVerticalCodes.js); a browser script inside each screen reads the code and applies that vertical\u2019s name, tagline, logo and colors from the manifest, with a luminance check so text on the brand color stays readable. Runs with --out to preview, --apply to PUT the flows as DRAFTS (a human clicks Deploy in DaVinci). Each flow is backed up before touching it.',
      },
    ],
  },
  {
    id: 'login',
    title: 'Login: widget and Orchestration SDK',
    rows: [
      {
        name: 'Widget policy (PINGONE_DAVINCI_LOGIN_POLICY_ID_V1)',
        what: 'A non-PingOne DaVinci flow with a widget success node; the embedded widget invocation (skRenderScreen) needs companyId + this per-version policy id, and the DaVinci API key is sent as X-SK-API-KEY when minting an SDK token server-side.',
      },
      {
        name: 'Orchestration SDK policy (PINGONE_DAVINCI_SDK_POLICY_ID)',
        what: 'A different DaVinci application and a PingOne redirect flow policy selected via pi.flow acr_values — the SDK lane and the widget lane deliberately use different apps/policies.',
      },
      {
        name: 'The vault gotcha',
        what: 'The DaVinci API key lives in the vault; configStore mirrors only two named secrets into process.env, so reading process.env made a correctly-vaulted key invisible and the route answered davinci_not_configured forever. config/davinci.js reads the key through configStore.getEffective (env first, vault fallback) — a plain .env value still wins for local runs.',
      },
    ],
  },
  {
    id: 'orchestration',
    title: 'Orchestration showcase (flag off by default)',
    rows: [
      {
        name: 'The flow',
        what: 'Transaction step-up decided by a DaVinci flow: PingOne SSO → Protect risk score → branch → MFA + a Generic HTTP connector alerting a fraud queue → Authorize → webhook back to POST /webhook/davinci (DAVINCI_WEBHOOK_URL or derived from the public app URL).',
      },
      {
        name: 'Fail-closed to the hand-coded path',
        what: 'Any DaVinci error falls back to the BFF\u2019s hand-coded OTP/MFA step-up flow — the showcase never blocks a transaction on DaVinci availability. Flow definitions on file: docs/Super_Banking_Transaction_Authorization_DaVinci.json and Super_Banking_MCP_Tool_Authorization_DaVinci.json; status in docs/DAVINCI_ORCHESTRATION_STATUS.md.',
      },
    ],
  },
];

export default function DavinciCibaFlowsPage() {
  return (
    <main className="dv-ciba" data-testid="davinci-ciba-flows">
      <PageHeader
        eyebrow="DaVinci · what we configured"
        title="DaVinci CIBA flows & orchestration"
        summary="The DaVinci side of the demo: the CIBA approval flows behind UC22/UC-LEARN14, the login widget and Orchestration SDK policies, and the flag-gated orchestration showcase that lets a DaVinci flow decide transaction step-up."
        actions={
          <Link className="dv-ciba__secondary" to="/pingfederate-davinci-kit">
            PF DaVinci kit
          </Link>
        }
      />

      {SECTIONS.map((s) => (
        <section key={s.id} className="dv-ciba__section" aria-labelledby={`dv-${s.id}`}>
          <h2 id={`dv-${s.id}`}>{s.title}</h2>
          <ul className="dv-ciba__rows">
            {s.rows.map((r) => (
              <li key={r.name} className="dv-ciba__row">
                <h3>{r.name}</h3>
                <p>{r.what}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
