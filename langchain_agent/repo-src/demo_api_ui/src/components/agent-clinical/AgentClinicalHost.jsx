import { useCallback, useEffect, useState } from 'react';
import { useVertical } from '../../vertical/useVertical';
import AgentTabsRail from './AgentTabsRail';
import TalkPane from './TalkPane';
import './clinical.css';

/**
 * AgentClinicalHost — top-level shell for the 2B refined dashboard.
 *
 * Owns the active-tab state and the keyboard shortcuts (1 = Talk, 2 = Inspect,
 * 3 = Configure). Renders the rail + the active pane stack. Phase 3a wires
 * the rail with a placeholder pane body; Phases 3b–3d swap the body for the
 * real TalkPane (chat + token timeline). Phase 4 adds Inspect; Phase 5 adds
 * Configure.
 */
export default function AgentClinicalHost() {
  const [view, setView] = useState('talk');
  const { pageManifest } = useVertical();
  const identity = pageManifest?.identity;
  const terminology = pageManifest?.terminology;

  // Brand label for the rail. Prefer the vertical's displayName so the rail
  // reads "Super Sports" / "Great Buy" / "CareConnect" instead of hardcoded
  // CareConnect. Split a CamelCase brand into two words so AgentTabsRail can
  // render the second half in italic teal (matches the mockup's "Care/Connect"
  // wordmark treatment).
  const brand = identity?.displayName || terminology?.brandName || 'CareConnect';
  const { brandPrefix, brandSuffix } = splitBrand(brand);

  const handleTabChange = useCallback((next) => {
    setView(next);
  }, []);

  // Keyboard 1 / 2 / 3 switch tabs. Skipped when focus is in an input so
  // typing "1" into a textarea doesn't snap the view away.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      if (e.key === '1') setView('talk');
      else if (e.key === '2') setView('inspect');
      else if (e.key === '3') setView('configure');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="ac-shell">
      <AgentTabsRail
        view={view}
        onChange={handleTabChange}
        brandPrefix={brandPrefix}
        brandSuffix={brandSuffix}
        sessionLabel="SESSION · 25:54"
        userInitials="DU"
      />

      <main className="ac-pane" role="tabpanel" aria-label={`${view} pane`}>
        {view === 'talk' ? <TalkPane /> : <PlaceholderPane view={view} />}
      </main>
    </div>
  );
}

/**
 * Phase 3a placeholder pane content. Confirms the rail switches state and the
 * design tokens carry through. Phases 3b+ swap this for the real TalkPane,
 * InspectPane, and ConfigurePane bodies.
 */
/**
 * Split a brand string into a prefix and suffix so the rail can render the
 * second half in italic teal. Handles "CareConnect" → ("Care", "Connect"),
 * "Super Sports" → ("Super", "Sports"), "Great Buy" → ("Great", "Buy"),
 * single-word brands → ("", brand).
 */
function splitBrand(brand) {
  if (!brand) return { brandPrefix: '', brandSuffix: 'CareConnect' };
  const spaceIdx = brand.indexOf(' ');
  if (spaceIdx > 0) {
    return { brandPrefix: brand.slice(0, spaceIdx + 1), brandSuffix: brand.slice(spaceIdx + 1) };
  }
  // CamelCase: split before the second capital letter run.
  const m = brand.match(/^([A-Z][a-z]+)([A-Z].*)$/);
  if (m) return { brandPrefix: m[1], brandSuffix: m[2] };
  return { brandPrefix: '', brandSuffix: brand };
}

function PlaceholderPane({ view }) {
  const labels = {
    talk:      { eyebrow: 'Assistant · vertical care', headline: 'How can I help, Demo?',  copy: 'Phase 3b wires the chat composer + audit timeline here.' },
    inspect:   { eyebrow: 'Inspect · session',         headline: 'Last exchanges',         copy: 'Phase 4 wraps ActivityLogPanel here.' },
    configure: { eyebrow: 'Configure · runtime',       headline: 'Runtime knobs',          copy: 'Phase 5 wires configStore-backed settings here.' },
  };
  const { eyebrow, headline, copy } = labels[view];

  return (
    <div className="ac-placeholder">
      <div className="ac-eyebrow">{eyebrow}</div>
      <h1 className="ac-headline">{headline}</h1>
      <p className="ac-copy">{copy}</p>
      <p className="ac-kbd-hint">
        Press <kbd>1</kbd> Talk &nbsp;·&nbsp; <kbd>2</kbd> Inspect &nbsp;·&nbsp; <kbd>3</kbd> Configure
      </p>
    </div>
  );
}
