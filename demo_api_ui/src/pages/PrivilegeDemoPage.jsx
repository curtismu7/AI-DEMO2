// demo_api_ui/src/pages/PrivilegeDemoPage.jsx
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import PrivilegeMcpOAuthConfig from '../components/privilege/PrivilegeMcpOAuthConfig';
import { PingProductChip } from '../components/PingProductChip';
import { useThemeOptional } from '../context/ThemeContext';
import {
  PRIVILEGE_DEMO,
  personaConsoleUrl,
} from '../config/privilegeDemoConfig';
import './PrivilegeDemoPage.css';

/**
 * Public SE presenter hub for the shared PingOne Privilege demo.
 */
export default function PrivilegeDemoPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();

  const personaEntries = useMemo(
    () => Object.values(PRIVILEGE_DEMO.personas),
    [],
  );

  return (
    <div className="pd-page">
      <header className="pd-page__header">
        <div className="pd-page__header-inner">
          <div>
            <div className="pd-page__product">
              <PingProductChip product={{ id: 'privilege', label: 'PingOne Privilege', cssClass: 'pp--privilege' }} size="sm" />
              <span className="pd-page__se-tag">SE presenter resource</span>
            </div>
            <h1>{PRIVILEGE_DEMO.title}</h1>
            <p className="pd-page__subtitle">{PRIVILEGE_DEMO.subtitle}</p>
          </div>
          <div className="pd-page__header-links">
            <Link to="/setup">Banking demo setup</Link>
            <a href="/api/auth/oauth/user/login?return_to=%2Fprivilege-demo">Sign in</a>
            <button
              type="button"
              className="pd-page__theme-toggle"
              onClick={toggleDarkMode}
              title="Switch this page between light and dark"
              aria-pressed={darkMode}
            >
              {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
            </button>
          </div>
        </div>
      </header>

      <div className="pd-persona-strip">
        <div className="pd-persona-strip__inner">
          {personaEntries.map((persona) => (
            <div key={persona.id} className="pd-persona-card">
              <strong>{persona.label}</strong>
              <span className="pd-persona-card__email">{persona.email}</span>
              <span className="pd-persona-card__vm">{persona.vm}</span>
              <a
                href={personaConsoleUrl(persona.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="pd-persona-card__link"
              >
                Open console
              </a>
            </div>
          ))}
        </div>
      </div>

      <div className="pd-page__body">
        <section className="pd-guide-callout">
          <p>{PRIVILEGE_DEMO.overview}</p>
          <a
            href={PRIVILEGE_DEMO.se1GuideUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pd-guide-callout__link"
          >
            Open the SE1 — Privilege Shared Demo guide
          </a>
        </section>

        <PrivilegeMcpOAuthConfig />

        <p className="pd-built-with">
          Built with the <code>privilege-admin-config-ui</code> skill (<code>.claude/skills/privilege-admin-config-ui/SKILL.md</code>) —
          the recipe for a Privilege admin/config page in this repo.
        </p>
      </div>
    </div>
  );
}
