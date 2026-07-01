/**
 * DemoServerCheckModal.js
 *
 * Shown on startup when one or more required servers are not reachable.
 * Displays exactly which server is missing and the command to start it.
 * No dismiss — the user must start the missing server; the modal retries
 * automatically every 5 seconds until all servers are up.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import "./DemoServerCheckModal.css";

const DEPLOYMENT_COMMANDS = [
  { label: "Node.js (development)", cmd: "./run.sh", key: "run-sh" },
  { label: "Docker", cmd: "./run-docker.sh", key: "run-docker-sh" },
  { label: "Kubernetes", cmd: "./run-k8.sh deploy", key: "run-k8-sh" },
];

/**
 * Poll /api/health/demo-status until all servers report up.
 * @param {function} onAllUp - called when every server is healthy
 * @param {function} onStatus - called with the latest status array (endpoint reached)
 * @param {function} onUnreachable - called when the health endpoint itself can't
 *   be reached (network error, or a non-JSON body such as a dev-proxy 500). This
 *   is a transport failure, NOT proof the servers are stopped — reporting it as
 *   "servers down" sends the user chasing start commands that won't help.
 * @param {number} intervalMs
 * @returns cleanup function
 */
function pollDemoStatus(onAllUp, onStatus, onUnreachable, intervalMs = 5000) {
  let cancelled = false;

  async function check() {
    if (cancelled) return;
    try {
      const res = await fetch("/api/health/demo-status", {
        credentials: "include",
      });
      // demo-status returns 200 (all up) or 503 (some down) — both carry a JSON
      // body with the servers array. A body that won't parse as JSON means we
      // never reached the endpoint (e.g. the dev proxy returned a 500/HTML), so
      // treat it as unreachable rather than inventing a down-servers list.
      const data = await res.json();
      if (!cancelled) {
        onStatus(data.servers || []);
        if (data.ok) onAllUp();
      }
    } catch (_) {
      if (!cancelled) onUnreachable();
    }
  }

  check();
  const id = setInterval(check, intervalMs);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
}

export default function DemoServerCheckModal({ downServers, onAllUp, onDismiss = null }) {
  const [servers, setServers] = useState(downServers || []);
  const [reachable, setReachable] = useState(true);
  const [copied, setCopied] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const cleanupRef = useRef(null);

  useEffect(() => {
    cleanupRef.current = pollDemoStatus(
      onAllUp,
      (latest) => {
        setReachable(true);
        setServers(latest.filter((s) => !s.up));
      },
      () => setReachable(false),
      5000,
    );
    return () => cleanupRef.current?.();
  }, [onAllUp]);

  const handleDismiss = useCallback(() => {
    if (onDismiss) onDismiss();
    else setDismissed(true);
  }, [onDismiss]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') handleDismiss(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleDismiss]);

  function copyCmd(cmd, key) {
    navigator.clipboard?.writeText(cmd).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  // Show while dismissed is false and either the endpoint is unreachable or it
  // reported one or more servers down.
  if (dismissed || (reachable && servers.length === 0)) return null;

  return (
    <div className="dsm-overlay" role="dialog" aria-modal="true" aria-label="Services not running">
      <div className="dsm-box">
        <div className="dsm-header">
          <span className="dsm-title">
            {reachable
              ? `Required server${servers.length > 1 ? "s" : ""} not running`
              : "Can't reach the demo health endpoint"}
          </span>
        </div>

        <div className="dsm-body">
          {reachable ? (
            <>
              <p className="dsm-intro">
                The demo requires all services to be started. The following{" "}
                {servers.length > 1 ? `${servers.length} servers are` : "server is"}{" "}
                not reachable:
              </p>

              <div className="dsm-servers">
                {servers.map((s) => (
                  <div key={s.key} className="dsm-server-card">
                    <div className="dsm-server-header">
                      <span className="dsm-server-name">{s.name}</span>
                      {s.port && (
                        <span className="dsm-server-port">:{s.port}</span>
                      )}
                    </div>
                    {s.description && (
                      <p className="dsm-server-desc">{s.description}</p>
                    )}
                    <div className="dsm-cmd-row">
                      <code className="dsm-cmd">{s.startCmd}</code>
                      <button
                        type="button"
                        className={`dsm-copy-btn${copied === s.key ? " dsm-copy-btn--ok" : ""}`}
                        onClick={() => copyCmd(s.startCmd, s.key)}
                        title="Copy command"
                        aria-label={
                          copied === s.key
                            ? "Copied!"
                            : `Copy start command for ${s.name}`
                        }
                      >
                        {copied === s.key ? "✓" : "⎘"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="dsm-intro">
              The UI couldn't reach <code>/api/health/demo-status</code>. This
              usually means the dev proxy can't reach the API server — a
              misconfigured <code>REACT_APP_API_HOST</code>, an HTTP/HTTPS
              mismatch, or the API container is down — rather than the services
              being stopped. Check <code>docker logs ai-demo-ui</code> for the
              resolved proxy target, then try starting everything:
            </p>
          )}

          <p className="dsm-hint">
            {reachable
              ? "Or start all services at once from the repo root:"
              : "Start all services from the repo root:"}
          </p>

          <div className="dsm-commands-section">
            {DEPLOYMENT_COMMANDS.map((cmd) => (
              <div key={cmd.key} className="dsm-command-group">
                <div className="dsm-command-label">{cmd.label}</div>
                <div className="dsm-cmd-row">
                  <code className="dsm-cmd">{cmd.cmd}</code>
                  <button
                    type="button"
                    className={`dsm-copy-btn${copied === cmd.key ? " dsm-copy-btn--ok" : ""}`}
                    onClick={() => copyCmd(cmd.cmd, cmd.key)}
                    title="Copy command"
                    aria-label={copied === cmd.key ? "Copied!" : `Copy ${cmd.cmd} command`}
                  >
                    {copied === cmd.key ? "✓" : "⎘"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dsm-footer">
          <span className="dsm-pulse" aria-hidden="true" />
          <span className="dsm-checking">Checking every 5 seconds...</span>
          <button
            type="button"
            className="dsm-dismiss-btn"
            onClick={handleDismiss}
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
