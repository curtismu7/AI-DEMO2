// demo_api_ui/src/pages/PrivilegeDemoPage.jsx
//
// /privilege-demo — the public SE presenter hub for the shared PingOne Privilege demo.
//
// Honesty: this is a guide page. The personas, links, readiness status and the registration details are
// written content (config and docs), not read from a live system. The one real action is the OAuth form's
// Test Connection (PrivilegeMcpOAuthConfig): it calls this machine's BFF, which mints a token and calls the
// Privilege gateway, and it shows the real result, including a failure (Auth Mode OAuth is a documented
// platform blocker).
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md)
// through the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame,
// P4 cards, P5 kv, P7 chips, P9 buttons. P6 (inspector) and P8 (diagram) are skipped: this page has no
// list/detail inspector and no diagram. The standalone shell bar is not added (the app has its own).
//
// P9, the one primary per view: SAVE is the primary, in every state (pristine, edited, saving, saved, error,
// with or without a test result). It is the only action that changes anything; Test Connection only checks
// what was saved, so it stays a secondary, like the live check on the other converted pages. Sign in and the
// light/dark switch are secondaries. The primary lives in PrivilegeMcpOAuthConfig, so this page hands it the
// class names (saveClassName / testClassName), which keeps the choice in one place, here.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { openSignIn } from '../utils/signInService';
import PrivilegeMcpOAuthConfig from '../components/privilege/PrivilegeMcpOAuthConfig';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import { useThemeOptional } from '../context/ThemeContext';
import {
  PRIVILEGE_DEMO,
  personaConsoleUrl,
} from '../config/privilegeDemoConfig';
import { KIBANA_URL, MCP_OBSERVABILITY_PATH } from '../config/observabilityLinks';
import './PrivilegeDemoPage.css';

export default function PrivilegeDemoPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();

  const personaEntries = useMemo(
    () => Object.values(PRIVILEGE_DEMO.personas),
    [],
  );

  return (
    <PingPage className="pd-page">
      <SimBanner data-testid="pd-banner">
        <strong>PRESENTER GUIDE</strong> — the personas, links, readiness status and registration details on this
        page are written content from config and docs, not read from a live system. The OAuth form is
        illustrative: Auth Mode OAuth is a documented platform blocker. Save stores the values on this
        machine&apos;s BFF. Test Connection is the one real call here, and it shows the real result,
        including a failure.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · SE presenter resource"
        title={PRIVILEGE_DEMO.title}
        summary={PRIVILEGE_DEMO.subtitle}
      />
      <PageFrame>
        <Section
          id="pd-personas-h"
          kicker="1 · Who you sign in as"
          title="Three personas for the shared demo"
          lede="Replace {seemail} with your own SE email prefix. Each console link opens that persona's PingOne environment in a new tab."
        >
          <CardGrid>
            {personaEntries.map((persona) => (
              <Card key={persona.id} title={persona.label} data-testid={`pd-persona-${persona.id}`}>
                <KvList
                  items={[
                    { label: 'Email', value: persona.email, mono: true },
                    { label: 'Where', value: persona.vm },
                  ]}
                />
                <p className="pu-note">
                  <a
                    href={personaConsoleUrl(persona.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open the PingOne console as ${persona.label} (new tab)`}
                  >
                    Open console
                  </a>
                </p>
              </Card>
            ))}
          </CardGrid>
        </Section>

        <Section
          id="pd-readiness-h"
          kicker="2 · Readiness"
          title="Tool & Agent Safety readiness"
        >
          <Card tone="neutral" data-testid="pd-readiness">
            <p className="pu-status-line">
              <StatusChip tone="ok">Passing</StatusChip>
              PingOne lane: all ten executable feature probes run live (A2A failure modes, the Attack Lab
              rows, Agent IAM Core, UC-LEARN11) and pass <code>demo:ready:local</code>.
            </p>
            <p className="pu-status-line">
              <StatusChip tone="warn">Blocked</StatusChip>
              PingFederate lane: fourteen rows are blocked on named source gaps, and the rest because the PF
              lane&apos;s readiness-user login fails. The local PingFederate admin credential was rotated by an
              out-of-repo session and is not recorded anywhere, so the lane cannot be re-provisioned until PF
              admin access is restored.
            </p>
            <p className="pu-note">
              Written status, not re-checked here. Per-row blockers: <code>docs/demo-readiness.md</code>.
            </p>
          </Card>
        </Section>

        <Section
          id="pd-guide-h"
          kicker="3 · Guide and links"
          title="The presenter script, and where to look next"
        >
          <CardGrid>
            <Card title="SE1 shared-demo guide" data-testid="pd-guide">
              <p className="pu-note">{PRIVILEGE_DEMO.overview}</p>
              <p className="pu-note">
                <a href={PRIVILEGE_DEMO.se1GuideUrl} target="_blank" rel="noopener noreferrer">
                  Open the SE1 — Privilege Shared Demo guide
                </a>
              </p>
            </Card>
            <Card title="Related pages and this session" data-testid="pd-links">
              <ul className="pd-links">
                <li><Link to="/setup">Banking demo setup</Link></li>
                <li><a href={KIBANA_URL} target="_blank" rel="noopener noreferrer">Kibana logs</a></li>
                <li><Link to={MCP_OBSERVABILITY_PATH}>MCP observability</Link></li>
              </ul>
              <div className="pu-actions">
                <button
                  type="button"
                  className="pu-btn"
                  data-testid="pd-signin"
                  onClick={() => openSignIn({ returnTo: '/privilege-demo' })}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className="pu-btn"
                  data-testid="pd-theme-toggle"
                  onClick={toggleDarkMode}
                  title="Switch this page between light and dark"
                >
                  {darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                </button>
              </div>
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="pd-oauth-h"
          kicker="4 · Config shape (illustrative)"
          title="banking-mcp OAuth configuration"
        >
          <PrivilegeMcpOAuthConfig
            saveClassName="pu-btn pu-btn--primary"
            testClassName="pu-btn"
          />
        </Section>

        <p className="pu-note pd-built-with">
          Built with the <code>privilege-admin-config-ui</code> skill (<code>.claude/skills/privilege-admin-config-ui/SKILL.md</code>) —
          the recipe for a Privilege admin/config page in this repo.
        </p>
      </PageFrame>
    </PingPage>
  );
}
