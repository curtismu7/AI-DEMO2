import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { useThemeOptional } from '../context/ThemeContext';

// Shared across every hook instance on a page, so two diagrams rendering at
// once (many pages have an architecture + a sequence diagram) never collide
// on a mermaid.render() id and a slower stale render can never overwrite a
// newer one, even across different diagrams.
let renderSeq = 0;

/**
 * Renders a Mermaid diagram into a container, following the app's light/dark
 * theme automatically (mermaid's own `dark`/`default` preset — same fix
 * already hand-rolled per-file in TokenExchangeDiagram.jsx and
 * PrivilegeGatewayTopologyPage.jsx, now shared). A diagram whose own source
 * carries a `%%{init}%%` directive (e.g. TokenChainArchitecturePage) is
 * unaffected — directives override mermaid.initialize() for that render.
 *
 * @param {string} source - Mermaid diagram source text.
 * @param {object} [options]
 * @param {'strict'|'loose'} [options.securityLevel='loose']
 * @param {object} [options.themeVariables] - passed through to mermaid.initialize;
 *   recompute per render (e.g. from darkMode) if it needs to track theme —
 *   the effect re-runs on every darkMode change and reads the latest closure.
 * @param {object} [options.flowchart] - passed through to mermaid.initialize.
 * @param {object} [options.sequence] - passed through to mermaid.initialize.
 * @param {(container: HTMLElement) => void} [options.onRendered] - called
 *   once after the SVG is injected, for post-render DOM work (e.g. stamping
 *   data-* attributes for CSS-driven highlighting).
 * @param {boolean} [options.darkMode] - override the app theme's dark/light
 *   read. Only needed by a page with its own independent dark-mode toggle
 *   (Protocol Playground has one, unrelated to the app-wide theme); every
 *   other caller omits this and gets the app theme automatically.
 * @returns {{ containerRef: import('react').RefObject<HTMLElement>, error: string|null }}
 */
export function useMermaidRender(source, options = {}) {
  const { securityLevel = 'loose', themeVariables, flowchart, sequence, onRendered } = options;
  const containerRef = useRef(null);
  const latestRef = useRef(0);
  const [error, setError] = useState(null);
  const { darkMode: appDarkMode } = useThemeOptional();
  const darkMode = options.darkMode ?? appDarkMode;

  useEffect(() => {
    if (!source) return undefined;
    let cancelled = false;
    const renderId = ++renderSeq;
    setError(null);

    mermaid.initialize({
      startOnLoad: false,
      theme: darkMode ? 'dark' : 'default',
      securityLevel,
      ...(themeVariables ? { themeVariables } : {}),
      ...(flowchart ? { flowchart } : {}),
      ...(sequence ? { sequence } : {}),
    });

    (async () => {
      try {
        const { svg } = await mermaid.render(`mmd-${renderId}`, source);
        if (!cancelled && latestRef.current <= renderId && containerRef.current) {
          latestRef.current = renderId;
          containerRef.current.innerHTML = svg;
          onRendered?.(containerRef.current);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Mermaid render failed');
      }
    })();

    return () => { cancelled = true; };
    // themeVariables/flowchart/sequence/onRendered are expected to be stable
    // across a source/darkMode-triggered re-run (module-level constants or a
    // value already captured by source/darkMode) — same assumption every
    // migrated caller's inline mermaid.initialize() already made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, darkMode, securityLevel]);

  return { containerRef, error };
}
