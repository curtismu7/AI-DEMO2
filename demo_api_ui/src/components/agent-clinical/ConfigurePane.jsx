import { useEffect, useState } from 'react';
import AuthorizeRulesPanel from '../AuthorizeRulesPanel';

/**
 * ConfigurePane — Phase 5: runtime configuration under the Configure tab.
 *
 * Left column: the existing AuthorizeRulesPanel mounted as-is (plan step 5.3
 * — "no code change to the panel; just a different mount point"). Its data
 * layer is the customer-safe /api/authorize/* routes.
 *
 * Right column: a read-only runtime status card from
 * GET /api/langchain/config/status (session-scoped, customer-safe). This
 * deliberately does NOT duplicate the Agent-mode / Wiring write controls —
 * those live in the chat header on the Talk tab, and the provider-selection
 * write path has a history of subtle session bugs (see REGRESSION_LOG /
 * "Missing Input" fix, 2026-07-03). One writer, one surface.
 */
export default function ConfigurePane() {
  const [runtime, setRuntime] = useState(null);
  const [runtimeErr, setRuntimeErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/langchain/config/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!cancelled) setRuntime(data);
      })
      .catch(() => {
        if (!cancelled) setRuntimeErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const modeLabel =
    runtime?.agent_modes?.find((m) => m.id === runtime?.agent_mode)?.label ||
    runtime?.agent_mode;

  return (
    <div className="ac-config">
      <section className="ac-config-main" aria-label="Authorize rules">
        <header className="ac-config-head">
          <div className="ac-eyebrow ac-eyebrow--small">Configure · authorization</div>
          <h1 className="ac-config-h1">
            Rules the agent <i>obeys</i>
          </h1>
        </header>
        <div className="ac-config-rules">
          <AuthorizeRulesPanel />
        </div>
      </section>

      <aside className="ac-config-aside" aria-label="Agent runtime status">
        <header className="ac-config-head">
          <div className="ac-eyebrow ac-eyebrow--small">Runtime</div>
          <h2 className="ac-config-h2">
            How the agent <i>runs</i>
          </h2>
        </header>

        {runtimeErr && (
          <div className="ac-runtime-empty">
            Runtime status unavailable — sign in and retry.
          </div>
        )}
        {!runtime && !runtimeErr && (
          <div className="ac-runtime-empty">Loading runtime status…</div>
        )}
        {runtime && (
          <dl className="ac-runtime-card">
            <div className="ac-runtime-row">
              <dt>Agent mode</dt>
              <dd>{modeLabel || '—'}</dd>
            </div>
            <div className="ac-runtime-row">
              <dt>Wiring</dt>
              <dd>{runtime.external_wiring === 'bff' ? 'via BFF (token chain intact)' : runtime.external_wiring || '—'}</dd>
            </div>
            <div className="ac-runtime-row">
              <dt>LLM provider</dt>
              <dd>{runtime.provider || '—'}</dd>
            </div>
            <div className="ac-runtime-row">
              <dt>Model</dt>
              <dd>{runtime.model || '—'}</dd>
            </div>
            {Array.isArray(runtime.fallback_order) && runtime.fallback_order.length > 0 && (
              <div className="ac-runtime-row">
                <dt>Fallback order</dt>
                <dd>{runtime.fallback_order.join(' → ')}</dd>
              </div>
            )}
            {runtime.key_set && (
              <div className="ac-runtime-row">
                <dt>Providers configured</dt>
                <dd>
                  {Object.entries(runtime.key_set)
                    .filter(([, ok]) => ok)
                    .map(([name]) => name)
                    .join(', ') || 'none'}
                </dd>
              </div>
            )}
          </dl>
        )}
        <p className="ac-runtime-note">
          Agent mode and wiring are changed from the chat header on the Talk
          tab — settings apply to this session immediately.
        </p>
      </aside>
    </div>
  );
}
