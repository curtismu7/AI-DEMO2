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
 * @param {function} onStatus - called with the latest status array
 * @param {number} intervalMs
 * @returns cleanup function
 */
function pollDemoStatus(onAllUp, onStatus, intervalMs = 5000) {
  let cancelled = false;

  async function check() {
    if (cancelled) return;
    try {
      const res = await fetch("/api/health/demo-status", {
        credentials: "include",
      });
      const data = await res.json();
      if (!cancelled) {
        onStatus(data.servers || []);
        if (data.ok) onAllUp();
      }
    } catch (_) {
      // BFF itself may be unreachable — surface all as down
      if (!cancelled) {
        onStatus([
          {
            name: "Banking API Server",
            key: "api_server",
            up: false,
            startCmd: "cd demo_api_server && npm start",
            description: "Express BFF",
            port: 3001,
          },
          {
            name: "Banking MCP Server",
            key: "mcp_server",
            up: false,
            startCmd: "cd demo_mcp_server && npm run dev",
            description: "MCP tool server",
            port: 8080,
          },
        ]);
      }
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
  const [copied, setCopied] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const cleanupRef = useRef(null);

  useEffect(() => {
    cleanupRef.current = pollDemoStatus(
      onAllUp,
      (latest) => {
        const stillDown = latest.filter((s) => !s.up);
        setServers(stillDown);
      },
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

  if (servers.length === 0 || dismissed) return null;

  return (
    <div className="dsm-overlay" role="dialog" aria-modal="true" aria-label="Services not running">
      <div className="dsm-box">
        <div className="dsm-header">
          <span className="dsm-title">
            Required server{servers.length > 1 ? "s" : ""} not running
          </span>
        </div>

        <div className="dsm-body">
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

          <p className="dsm-hint">
            Or start all services at once from the repo root:
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
