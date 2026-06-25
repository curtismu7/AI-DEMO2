import React, { useState } from "react";
import "./MigrationPanel.css";

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      className="migration-copy-btn"
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ code }) {
  return (
    <div className="migration-code-block">
      <pre className="migration-code-pre">{code}</pre>
      <CopyButton text={code} />
    </div>
  );
}

export default function MigrationPanel() {
  const [activeMode, setActiveMode] = useState("export");

  return (
    <div className="migration-panel">
      <div className="migration-mode-tabs">
        <button
          type="button"
          className={`migration-mode-tab${activeMode === "export" ? " active" : ""}`}
          onClick={() => setActiveMode("export")}
        >
          Export
        </button>
        <button
          type="button"
          className={`migration-mode-tab${activeMode === "import" ? " active" : ""}`}
          onClick={() => setActiveMode("import")}
        >
          Import
        </button>
      </div>

      {activeMode === "export" && (
        <div className="migration-section">
          <h3 className="migration-section-title">Export your configuration</h3>
          <p className="migration-section-desc">
            Creates a single <code>.tar.gz</code> archive containing your
            PingOne credentials, feature flags, demo data, and <code>.env</code>{" "}
            file. Copy it to another machine and import it there — no manual
            credential re-entry needed.
          </p>

          <div className="migration-step">
            <div className="migration-step-num">1</div>
            <div className="migration-step-body">
              <strong>Open a terminal in the project root</strong>
              <p className="migration-step-note">
                The server can stay running during export — databases are opened
                read-only automatically.
              </p>
            </div>
          </div>

          <div className="migration-step">
            <div className="migration-step-num">2</div>
            <div className="migration-step-body">
              <strong>Run the export command</strong>
              <CodeBlock code="cd demo_api_server && npm run data:export" />
              <p className="migration-step-note">
                By default the archive is written to{" "}
                <code>banking-export-&lt;timestamp&gt;.tar.gz</code> in the
                current directory. To choose a different path:
              </p>
              <CodeBlock code="npm run data:export -- --out ~/Desktop/my-export.tar.gz" />
            </div>
          </div>

          <div className="migration-step">
            <div className="migration-step-num">3</div>
            <div className="migration-step-body">
              <strong>What the archive contains</strong>
              <table className="migration-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Contents</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>manifest.json</code>
                    </td>
                    <td>Archive version, timestamp, file list</td>
                  </tr>
                  <tr>
                    <td>
                      <code>.env</code>
                    </td>
                    <td>
                      All environment variables including{" "}
                      <code>SESSION_SECRET</code>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>persistent/config.db</code>
                    </td>
                    <td>All saved credentials and feature flags</td>
                  </tr>
                  <tr>
                    <td>
                      <code>persistent/banking.db</code>
                    </td>
                    <td>Banking transactions and account records</td>
                  </tr>
                  <tr>
                    <td>
                      <code>persistent/delegations.db</code>
                    </td>
                    <td>Agent token delegation records</td>
                  </tr>
                  <tr>
                    <td>
                      <code>persistent/*.json</code>
                    </td>
                    <td>Demo users, accounts, transactions, audit logs</td>
                  </tr>
                </tbody>
              </table>
              <p className="migration-step-note migration-step-note--excluded">
                <strong>Not included:</strong> <code>sessions.db</code>{" "}
                (machine-bound Express sessions — all users log in fresh after
                import).
              </p>
            </div>
          </div>

          <div className="migration-warning">
            <strong>Security:</strong> This archive contains your{" "}
            <code>.env</code> and all database secrets. Transfer it via a secure
            channel (scp, encrypted USB) — do not commit to git or upload to
            public storage.
          </div>
        </div>
      )}

      {activeMode === "import" && (
        <div className="migration-section">
          <h3 className="migration-section-title">Import on a new machine</h3>
          <p className="migration-section-desc">
            Restores a complete configuration from an export archive. The server
            must be stopped before importing because LMDB holds an exclusive
            write lock on its database files.
          </p>

          <div className="migration-step">
            <div className="migration-step-num">1</div>
            <div className="migration-step-body">
              <strong>Stop the server</strong>
              <CodeBlock code="./run-demo.sh stop" />
              <p className="migration-step-note">
                The import will exit with an error if the server is still
                running — nothing will be changed.
              </p>
            </div>
          </div>

          <div className="migration-step">
            <div className="migration-step-num">2</div>
            <div className="migration-step-body">
              <strong>Install dependencies (first time only)</strong>
              <CodeBlock code="cd demo_api_server && npm install" />
            </div>
          </div>

          <div className="migration-step">
            <div className="migration-step-num">3</div>
            <div className="migration-step-body">
              <strong>Run the import command</strong>
              <CodeBlock code="npm run data:import -- ./banking-export-<timestamp>.tar.gz" />
              <p className="migration-step-note">
                Replace <code>&lt;timestamp&gt;</code> with the actual filename
                from your archive. The script will:
              </p>
              <ul className="migration-list">
                <li>
                  Back up existing <code>data/persistent/</code> and{" "}
                  <code>.env</code> before touching anything
                </li>
                <li>
                  Extract all database files and overwrite <code>.env</code>
                </li>
                <li>
                  Run a health check — if <code>config.db</code> fails to
                  decrypt, rollback instructions are printed
                </li>
              </ul>
            </div>
          </div>

          <div className="migration-step">
            <div className="migration-step-num">4</div>
            <div className="migration-step-body">
              <strong>Start the server</strong>
              <CodeBlock code="./run-demo.sh" />
            </div>
          </div>

          <div className="migration-info">
            <strong>Rollback:</strong> If something goes wrong, the import
            script prints the exact commands to restore your previous state from
            the backup created in step 3.
          </div>
        </div>
      )}
    </div>
  );
}
