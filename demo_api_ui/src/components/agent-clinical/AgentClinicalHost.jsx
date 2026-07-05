import { useCallback, useEffect, useState } from 'react';
import { useVertical } from '../../vertical/useVertical';
import AgentTabsRail from './AgentTabsRail';
import TalkPane from './TalkPane';
import InspectPane from './InspectPane';
import ConfigurePane from './ConfigurePane';
import './clinical.css';

/**
 * AgentClinicalHost — top-level shell for the 2B refined dashboard.
 *
 * Owns the active-tab state and the keyboard shortcuts (1 = Talk, 2 = Inspect,
 * 3 = Configure). Renders the rail + the active pane stack: TalkPane (chat +
 * token timeline), InspectPane (live activity log) and ConfigurePane
 * (authorize rules + runtime status). Panes mount only while active so their
 * data layers (SSE stream, fetches) start on tab enter and stop on tab leave.
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
        {view === 'talk' && <TalkPane />}
        {view === 'inspect' && <InspectPane />}
        {view === 'configure' && <ConfigurePane />}
      </main>
    </div>
  );
}

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

