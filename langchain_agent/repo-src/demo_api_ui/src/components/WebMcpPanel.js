// banking_api_ui/src/components/WebMcpPanel.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  listMcpToolsWithStream,
  callMcpTool,
  openMcpToolStream,
} from "../services/webMcpClient";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { useEducationUI } from "../context/EducationUIContext";
import { EDU } from "./education/educationIds";
import PageNav from "./PageNav";
import "../styles/appShellPages.css";
import "../styles/rule-panel.css";
import "./WebMcpPanel.css";
import {
  ACCOUNT_ID_KEYS,
  DESCRIPTION_SUGGESTIONS,
  QUERY_SUGGESTIONS,
} from '../constants/mcpFieldKeys';
import AdminTokenNotice from './AdminTokenNotice';
import McpParamSelect from './McpParamSelect';
import McpParamToggle from './McpParamToggle';
import McpParamSuggest from './McpParamSuggest';
import McpParamText from './McpParamText';

// Use the built-in Web Crypto / Node crypto.randomUUID() instead of the
// `uuid` npm package — same output (RFC 4122 v4), no dependency, no Jest
// ESM-transform issues. Available in Node 19+ and all evergreen browsers.
// The Math.random fallback exists only for jsdom test environments where
// `crypto` is not yet exposed on the global; production paths never hit it.
const uuid = () =>
  (typeof window !== "undefined" && window.crypto?.randomUUID?.()) ||
  "00000000-0000-4000-8000-".concat(
    Math.floor(Math.random() * 1e12).toString(16).padStart(12, "0"),
  );

const TRANSFER_TOOL = "create_transfer";
// Tools that always require HITL browser consent (can't execute inline)
const HITL_TOOLS = new Set(["create_deposit", "create_withdrawal", TRANSFER_TOOL]);
// Tools that require step-up MFA
const STEPUP_TOOLS = new Set(["get_sensitive_account_details"]);

/**
 * Interpret what a tool result means so we can show context alongside the raw JSON.
 * Returns null for clean success, or an object describing what gate fired.
 */
function interpretResult(result) {
  if (!result) return null;

  if (result.error === "hitl_required" || result.hitl) {
    const threshold = result.hitl_threshold_usd;
    return {
      kind: "hitl",
      title: "Human-in-the-Loop (HITL) consent required",
      detail:
        threshold != null
          ? `Transactions above $${threshold} require explicit human approval before the MCP server will execute them. ` +
            `This is a security control — the agent cannot bypass it. ` +
            `To approve this action, use the AI agent on the dashboard: it will present a consent dialog before executing the tool.`
          : `Transfers always require explicit human approval regardless of amount. ` +
            `Use the AI agent on the dashboard to complete this action through the consent screen.`,
    };
  }

  if (result.error === "step_up_required" || result.step_up_required) {
    const method = result.step_up_method || "email";
    return {
      kind: "stepup",
      title: "Step-up MFA verification required",
      detail:
        `This tool requires elevated authentication (${method} OTP or MFA challenge) before the MCP server will execute it. ` +
        `Complete a step-up challenge via the AI agent on the dashboard — once verified, ` +
        `your session will be elevated and this tool will execute.`,
    };
  }

  if (result.success === true || result.result?.success === true) {
    return { kind: "success" };
  }

  if (result.error && result.error !== "hitl_required" && result.error !== "step_up_required") {
    return { kind: "tool_error", title: "Tool returned an error", detail: result.message || result.error };
  }

  return null;
}

/**
 * Best-effort extraction of structured lists from tool results.
 * Returns an object with extracted options, or null if not applicable.
 */
function extractResultData(toolName, result) {
  try {
    // Tool handlers return result as JSON string in result.text or result.result.text
    const raw = result?.text ?? result?.result?.text ?? null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    if (toolName === 'get_my_accounts') {
      const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
      if (!Array.isArray(accounts)) return null;
      return {
        accountOptions: accounts.map((a) => ({
          value: a.id,
          label: `${a.accountType ? a.accountType.charAt(0).toUpperCase() + a.accountType.slice(1) : 'Account'} — $${Number(a.balance || 0).toLocaleString()}`,
        })),
      };
    }

    if (toolName === 'lookup_customer') {
      const users = Array.isArray(parsed) ? parsed : parsed?.users;
      if (!Array.isArray(users)) return null;
      return {
        userOptions: users.map((u) => ({
          value: u.id,
          label: `${u.firstName || ''} ${u.lastName || ''} (${u.email || u.username || u.id})`.trim(),
        })),
      };
    }

    if (toolName === 'get_customer_accounts') {
      const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
      if (!Array.isArray(accounts)) return null;
      return {
        adminAccountOptions: accounts.map((a) => ({
          value: a.id,
          label: `${a.name || a.accountType || 'Account'} — $${Number(a.balance || 0).toLocaleString()}`,
        })),
      };
    }
  } catch {
    // silent — plain JSON display is unaffected
  }
  return null;
}

function GateNotice({ kind, title, children }) {
  return (
    <div className={`webmcp-gate-notice webmcp-gate-notice--${kind}`}>
      <span className="webmcp-gate-notice__icon">⚠️</span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

export default function WebMcpPanel() {
  const [tools, setTools] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [params, setParams] = useState({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [streamEvents, setStreamEvents] = useState([]);
  const [error, setError] = useState(null);
  const [discoveryPhases, setDiscoveryPhases] = useState([]);
  const [accountOptions, setAccountOptions] = useState([]); // [{value, label}]
  const [accountsRestricted, setAccountsRestricted] = useState(false);
  const [userOptions, setUserOptions]       = useState([]); // [{value, label}]
  const [adminAccountOptions, setAdminAccountOptions] = useState([]); // [{value, label}]
  const accountsFetched = useRef(false);
  const streamLogRef = useRef(null);
  const disconnectRef = useRef(null);
  const { setWebMcpLastResult } = useAgentUiMode();
  const { open } = useEducationUI();

  // Fetch user accounts once and cache in state for dropdowns
  const ensureAccountOptions = useCallback(async () => {
    if (accountsFetched.current) return;
    accountsFetched.current = true;
    try {
      const res = await fetch(`${process.env.REACT_APP_API_BASE || ''}/api/accounts/my`, {
        credentials: 'include',
      });
      if (res.status === 403) { setAccountsRestricted(true); return; }
      if (!res.ok) return;
      const data = await res.json();
      const accounts = data.accounts || data || [];
      setAccountOptions(
        accounts.map((a) => ({
          value: a.id,
          label: `${a.accountType ? a.accountType.charAt(0).toUpperCase() + a.accountType.slice(1) : 'Account'} — $${Number(a.balance || 0).toLocaleString()}`,
        }))
      );
    } catch {
      // best-effort — falls back to plain text input
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setDiscoveryPhases([]);
    const traceId = uuid();
    const controller = new AbortController();
    let cancelled = false;
    const onPhase = (phase) => {
      if (cancelled) return;
      // Collapse consecutive updates to the same phase id by replacing the
      // existing row rather than appending — keeps the list short and lets
      // the final 'success' status overwrite the 'active' one.
      setDiscoveryPhases((prev) => {
        const next = [...prev];
        const idx = next.findIndex((p) => p.phase === phase.phase);
        if (idx >= 0) next[idx] = phase;
        else next.push(phase);
        return next;
      });
    };
    listMcpToolsWithStream(traceId, onPhase, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setTools(data.tools || []);
        setError(null);
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return;
        let parsedBody = null;
        if (err.body) {
          try { parsedBody = JSON.parse(err.body); } catch (_) {}
        }
        const summaryCandidate = parsedBody ? {
          error:             parsedBody.error,
          error_description: parsedBody.error_description,
          authorize_engine:  parsedBody.authorize_engine,
          decisionContext:   parsedBody.decisionContext,
          decisionId:        parsedBody.decisionId,
        } : null;
        const hasSummaryFields = summaryCandidate &&
          Object.values(summaryCandidate).some(v => v != null);
        setError({
          message:
            "Could not load MCP tools — check that the MCP server is running.",
          statusLine: err.message,
          summary: hasSummaryFields ? summaryCandidate : null,
          parsedBody: parsedBody || null,
          rawBody:    parsedBody ? null : (err.body || null),
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (streamLogRef.current) {
      streamLogRef.current.scrollTop = streamLogRef.current.scrollHeight;
    }
  }, [streamEvents]);

  useEffect(() => {
    return () => {
      if (disconnectRef.current) disconnectRef.current();
    };
  }, []);

  const selectTool = useCallback((tool) => {
    setSelectedTool(tool);
    setParams({});
    setResult(null);
    setStreamEvents([]);
    setError(null);
    // Pre-fetch accounts if this tool has account_id params
    const toolProps = tool?.inputSchema?.properties || {};
    const hasAccountParam = Object.keys(toolProps).some((k) => ACCOUNT_ID_KEYS.has(k));
    if (hasAccountParam) ensureAccountOptions();
  }, [ensureAccountOptions]);

  const handleParamChange = useCallback((key, value) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const callSelectedTool = useCallback(async () => {
    if (!selectedTool) return;
    setLoading(true);
    setResult(null);
    setStreamEvents([]);
    setError(null);

    const flowTraceId = uuid();

    if (disconnectRef.current) disconnectRef.current();
    disconnectRef.current = openMcpToolStream(flowTraceId, (data) => {
      setStreamEvents((prev) => [
        ...prev,
        { key: `${flowTraceId}-${prev.length}`, data },
      ]);
    });

    try {
      const res = await callMcpTool(selectedTool.name, params, flowTraceId);
      setResult(res);
      if (setWebMcpLastResult) setWebMcpLastResult(res);
      // Extract structured data from result and update dropdown options
      const extracted = extractResultData(selectedTool.name, res);
      if (extracted?.accountOptions) {
        setAccountOptions(extracted.accountOptions);
        accountsFetched.current = true;
      }
      if (extracted?.userOptions)         setUserOptions(extracted.userOptions);
      if (extracted?.adminAccountOptions) setAdminAccountOptions(extracted.adminAccountOptions);
    } catch (err) {
      let parsedBody = null;
      if (err.body) {
        try { parsedBody = JSON.parse(err.body); } catch (_) {}
      }
      const summaryCandidate = parsedBody ? {
        error:             parsedBody.error,
        error_description: parsedBody.error_description,
        authorize_engine:  parsedBody.authorize_engine,
        decisionContext:   parsedBody.decisionContext,
        decisionId:        parsedBody.decisionId,
      } : null;
      const hasSummaryFields = summaryCandidate &&
        Object.values(summaryCandidate).some(v => v != null);
      setError({
        message: "Tool call failed — check connection or permissions.",
        statusLine: err.message,
        summary: hasSummaryFields ? summaryCandidate : null,
        parsedBody: parsedBody || null,
        rawBody:    parsedBody ? null : (err.body || null),
      });
    } finally {
      setLoading(false);
    }
  }, [selectedTool, params, setWebMcpLastResult]);

  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredFields = selectedTool?.inputSchema?.required || [];

  // Build account options for to_account_id, excluding the currently-selected from_account_id
  const toAccountOptions = accountOptions.filter(
    (opt) => !params['from_account_id'] || opt.value !== params['from_account_id']
  );

  // Determine description suggestions based on the selected tool name
  const descSuggestions = DESCRIPTION_SUGGESTIONS[selectedTool?.name] || [];

  // Determine per-key dropdown options
  const getDropdownOptions = (key) => {
    if (key === 'account_id') return accountOptions;
    if (key === 'from_account_id') return accountOptions;
    if (key === 'to_account_id') return toAccountOptions;
    if (key === 'userId') return userOptions;
    if (key === 'accountId') return adminAccountOptions;
    if (key === 'account_type') return [
      { value: 'checking',    label: 'Checking' },
      { value: 'savings',     label: 'Savings' },
      { value: 'loan',        label: 'Loan' },
      { value: 'credit',      label: 'Credit' },
      { value: 'investment',  label: 'Investment' },
    ];
    if (key === 'limit') return [
      { value: '5',  label: '5' },
      { value: '10', label: '10' },
      { value: '20', label: '20' },
      { value: '50', label: '50' },
    ];
    return null;
  };

  // Unwrap result — the BFF wraps the actual tool result in a `result` key
  const toolResult = result?.result ?? result;
  const interpretation = interpretResult(toolResult);

  return (
    <div className="app-page-shell">
      <div className="app-page-shell__body">
        <PageNav title="WebMCP — Tool Inspector" />

        {accountsRestricted && <AdminTokenNotice />}

        <div className="app-page-toolbar app-page-toolbar--start">
          <button
            type="button"
            className="app-page-toolbar-btn"
            onClick={() => open(EDU.WEB_MCP, "overview")}
          >
            What is WebMCP?
          </button>
          <button
            type="button"
            className="app-page-toolbar-btn"
            onClick={() => open(EDU.WEB_MCP, "architecture")}
          >
            Architecture
          </button>
          <button
            type="button"
            className="app-page-toolbar-btn"
            onClick={() => open(EDU.MCP_PROTOCOL, "what")}
          >
            MCP Protocol
          </button>
          <button
            type="button"
            className="app-page-toolbar-btn"
            onClick={() => open(EDU.TOKEN_EXCHANGE, "why")}
          >
            Token Exchange
          </button>
        </div>

        <div className="rp-container" style={{ margin: '16px 0' }}>
          {loading && !selectedTool && (
            <div className="webmcp-loading">
              <div className="webmcp-loading__header">
                <span className="webmcp-calling-spinner" aria-hidden="true" />
                <span>
                  Loading MCP tools — this can take a few seconds on a fresh
                  session while the BFF verifies your token with PingOne,
                  exchanges it for an MCP-scoped token, and opens the WebSocket
                  to the MCP server.
                </span>
              </div>
              {discoveryPhases.length > 0 && (
                <ol
                  className="webmcp-discovery-phases"
                  aria-live="polite"
                  role="status"
                >
                  {discoveryPhases.map((p) => (
                    <li
                      key={p.phase}
                      className={`webmcp-discovery-phase webmcp-discovery-phase--${p.status || 'active'}`}
                    >
                      <span className="webmcp-discovery-phase__status" aria-hidden="true" />
                      <div className="webmcp-discovery-phase__text">
                        <div className="webmcp-discovery-phase__label">{p.label}</div>
                        {p.technical && (
                          <div className="webmcp-discovery-phase__technical">{p.technical}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {error && !selectedTool && (
            <div className="webmcp-error">
              {discoveryPhases.length > 0 && (
                <ol className="webmcp-discovery-phases">
                  {discoveryPhases.map((p) => (
                    <li
                      key={p.phase}
                      className={`webmcp-discovery-phase webmcp-discovery-phase--${p.status || 'active'}`}
                    >
                      <span className="webmcp-discovery-phase__status" aria-hidden="true" />
                      <div className="webmcp-discovery-phase__text">
                        <div className="webmcp-discovery-phase__label">{p.label}</div>
                        {p.technical && (
                          <div className="webmcp-discovery-phase__technical">{p.technical}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <p>{error.message}</p>
              <details>
                <summary>Technical details</summary>
                {error.statusLine && (
                  <p className="webmcp-error__status">{error.statusLine}</p>
                )}
                {error.summary && (
                  <table className="webmcp-error__summary">
                    <tbody>
                      {Object.entries(error.summary)
                        .filter(([, v]) => v != null)
                        .map(([k, v]) => (
                          <tr key={k}>
                            <th>{k}</th>
                            <td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
                {error.parsedBody && (
                  <details className="webmcp-error__full">
                    <summary>Full response</summary>
                    <pre>{JSON.stringify(error.parsedBody, null, 2)}</pre>
                  </details>
                )}
                {error.rawBody && (
                  <pre>{error.rawBody}</pre>
                )}
              </details>
            </div>
          )}

          <div className="rp-body">
            <div className="rp-list">
              <div className="rp-list-group-header">Available Tools ({tools.length})</div>
              {tools.length > 0 && (
                <div className="rp-list-hint">Select a tool to inspect and call it</div>
              )}
              {tools.map((tool) => {
                const isHitl = HITL_TOOLS.has(tool.name);
                const isStepUp = STEPUP_TOOLS.has(tool.name);
                return (
                  <button
                    key={tool.name}
                    type="button"
                    className={`rp-list-item${selectedTool?.name === tool.name ? " rp-list-item--active" : ""}`}
                    onClick={() => selectTool(tool)}
                  >
                    <div className="rp-list-item__name">{tool.name}</div>
                    <div className="rp-list-item__sub">{tool.description}</div>
                    {isHitl && (
                      <span className="webmcp-tool-badge webmcp-tool-badge--hitl">
                        Requires consent
                      </span>
                    )}
                    {isStepUp && (
                      <span className="webmcp-tool-badge webmcp-tool-badge--stepup">
                        Requires step-up
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {!selectedTool && tools.length > 0 && (
              <div className="webmcp-tool-placeholder">
                <p>
                  Select a tool from the list to inspect its schema, fill in
                  parameters, and call it live through the MCP pipeline.
                </p>
              </div>
            )}

            {selectedTool && (
              <div className="rp-detail">
                <div className="rp-detail__title">{selectedTool.name}</div>
                <div className="rp-detail__desc">
                  {selectedTool.description}
                </div>

                {HITL_TOOLS.has(selectedTool.name) && (
                  <GateNotice kind="hitl" title="Human-in-the-Loop (HITL) required">
                    {selectedTool.name === TRANSFER_TOOL
                      ? "Transfers always require explicit human approval — the MCP server enforces this regardless of amount."
                      : "Deposits and withdrawals above the configured threshold require human approval."}
                    {" "}You can still call this tool here to see exactly what the server returns.
                  </GateNotice>
                )}
                {STEPUP_TOOLS.has(selectedTool.name) && (
                  <GateNotice kind="stepup" title="Step-up MFA required">
                    This tool requires elevated authentication. Complete a step-up challenge
                    via the AI agent on the dashboard first.
                    You can still call it here to see the server response.
                  </GateNotice>
                )}

                {Object.keys(schemaProps).length > 0 && (
                  <div className="rp-test-form">
                    <div className="rp-test-form__heading">Parameters</div>
                    {Object.entries(schemaProps).map(([key, schema]) => {
                      const isRequired = requiredFields.includes(key);
                      const hint = schema.description || '';
                      const dropdownOptions = getDropdownOptions(key);
                      const isToggle = key === 'freeze' || key === 'confirm' || schema.type === 'boolean';
                      const isSuggest = key === 'description' && descSuggestions.length > 0;
                      const isSuggestQuery = key === 'query';

                      if (isToggle) {
                        return (
                          <McpParamToggle
                            key={key}
                            paramKey={key}
                            label={key}
                            value={params[key] || ''}
                            onChange={(v) => handleParamChange(key, v)}
                            hint={hint}
                          />
                        );
                      }

                      if (dropdownOptions) {
                        return (
                          <McpParamSelect
                            key={key}
                            paramKey={key}
                            label={key}
                            options={dropdownOptions}
                            value={params[key] || ''}
                            onChange={(v) => handleParamChange(key, v)}
                            required={isRequired}
                            hint={hint}
                          />
                        );
                      }

                      if (isSuggest) {
                        return (
                          <McpParamSuggest
                            key={key}
                            paramKey={key}
                            label={key}
                            suggestions={descSuggestions}
                            value={params[key] || ''}
                            onChange={(v) => handleParamChange(key, v)}
                            placeholder={schema.type || ''}
                            hint={hint}
                          />
                        );
                      }

                      if (isSuggestQuery) {
                        return (
                          <McpParamSuggest
                            key={key}
                            paramKey={key}
                            label={key}
                            suggestions={QUERY_SUGGESTIONS}
                            value={params[key] || ''}
                            onChange={(v) => handleParamChange(key, v)}
                            placeholder={schema.type || ''}
                            hint={hint}
                          />
                        );
                      }

                      // Default: plain text input with label + hint.
                      // Infer a richer HTML input type from the JSON Schema so
                      // dates/amounts get native pickers instead of free-text.
                      const isDate =
                        schema.format === 'date' ||
                        (schema.type === 'string' && /date$/i.test(key));
                      const isNumber = schema.type === 'number' || schema.type === 'integer';
                      const inputType = isDate ? 'date' : isNumber ? 'number' : 'text';
                      const step = schema.type === 'integer' ? '1' : isNumber ? 'any' : undefined;
                      return (
                        <McpParamText
                          key={key}
                          paramKey={key}
                          label={key}
                          value={params[key] || ''}
                          onChange={(v) => handleParamChange(key, v)}
                          placeholder={schema.type || ''}
                          hint={hint}
                          required={isRequired}
                          inputType={inputType}
                          step={step}
                        />
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  className="rp-btn-primary"
                  onClick={callSelectedTool}
                  disabled={loading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}
                >
                  {loading && <span className="webmcp-btn-spinner" aria-hidden="true" />}
                  {loading ? "Calling…" : "Call Tool"}
                </button>

                {loading && (
                  <div className="webmcp-calling-status">
                    <span className="webmcp-calling-spinner" aria-hidden="true" />
                    <span>
                      Calling <strong>{selectedTool.name}</strong> — waiting for response…
                    </span>
                  </div>
                )}

                {streamEvents.length > 0 && (
                  <div className="webmcp-stream-log" ref={streamLogRef}>
                    <h5>Pipeline Events</h5>
                    {streamEvents.map((item) => (
                      <div key={item.key} className="webmcp-stream-event">
                        {JSON.stringify(item.data, null, 2)}
                      </div>
                    ))}
                  </div>
                )}

                {result && (
                  <div className="webmcp-result">
                    {interpretation && (
                      interpretation.kind === "success" ? (
                        <div className="webmcp-result-context webmcp-result-context--success">
                          <span className="webmcp-result-context__icon">✅</span>
                          <strong>Tool executed successfully</strong>
                        </div>
                      ) : (
                        <div className={`webmcp-result-context webmcp-result-context--${interpretation.kind}`}>
                          <span className="webmcp-result-context__icon">
                            {interpretation.kind === "tool_error" ? "❌" : "⚠️"}
                          </span>
                          <div>
                            <strong>{interpretation.title}</strong>
                            {interpretation.detail && <p>{interpretation.detail}</p>}
                          </div>
                        </div>
                      )
                    )}
                    <h5>Server Response</h5>
                    <pre>{JSON.stringify(result, null, 2)}</pre>
                  </div>
                )}

                {error && (
                  <div className="webmcp-error">
                    <p>{error.message}</p>
                    <details>
                      <summary>Technical details</summary>
                      {error.statusLine && (
                        <p className="webmcp-error__status">{error.statusLine}</p>
                      )}
                      {error.summary && (
                        <table className="webmcp-error__summary">
                          <tbody>
                            {Object.entries(error.summary)
                              .filter(([, v]) => v != null)
                              .map(([k, v]) => (
                                <tr key={k}>
                                  <th>{k}</th>
                                  <td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      )}
                      {error.parsedBody && (
                        <details className="webmcp-error__full">
                          <summary>Full response</summary>
                          <pre>{JSON.stringify(error.parsedBody, null, 2)}</pre>
                        </details>
                      )}
                      {error.rawBody && (
                        <pre>{error.rawBody}</pre>
                      )}
                    </details>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
