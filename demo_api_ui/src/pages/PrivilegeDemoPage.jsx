// demo_api_ui/src/pages/PrivilegeDemoPage.jsx
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PrivilegeSetupChecklist from '../components/privilege/PrivilegeSetupChecklist';
import PrivilegeScriptGuide from '../components/privilege/PrivilegeScriptGuide';
import { PingProductChip } from '../components/PingProductChip';
import {
  PRIVILEGE_DEMO,
  personaConsoleUrl,
} from '../config/privilegeDemoConfig';
import './PrivilegeDemoPage.css';

const TABS = [
  { id: 'setup', label: 'Setup' },
  { id: 'script', label: 'Script' },
];

/**
 * Public SE presenter hub for the shared PingOne Privilege demo.
 */
export default function PrivilegeDemoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'script' ? 'script' : 'setup';
  const initialAct = Number.parseInt(searchParams.get('act') || '1', 10);

  const personaEntries = useMemo(
    () => Object.values(PRIVILEGE_DEMO.personas),
    [],
  );

  const handleTabChange = (nextTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    if (nextTab === 'setup') next.delete('act');
    setSearchParams(next, { replace: true });
  };

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
            <Link to="/onboarding">Banking demo setup</Link>
            <Link to="/">Sign in</Link>
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
        <nav className="pd-tabs" aria-label="Privilege demo sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pd-tabs__btn${tab === t.id ? ' pd-tabs__btn--active' : ''}`}
              onClick={() => handleTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'setup' ? (
          <PrivilegeSetupChecklist />
        ) : (
          <PrivilegeScriptGuide initialAct={Number.isFinite(initialAct) ? initialAct : 1} />
        )}
      </div>
    </div>
  );
}
