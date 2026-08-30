import { useState, useEffect, useMemo, useCallback } from 'react';
import bffAxios from '../services/bffAxios';
import { displayDecision } from '../utils/authorizeResultExplain';

/**
 * usePingOneAuthorizeConsole — unified state + logic for the P1AZ console tab.
 * Consolidates all form state, policy evaluation, run history (reel), and replay.
 */
export function usePingOneAuthorizeConsole({
  endpointId,
  autoPreset,
  policiesState,
  pendingTest,
  onClearPendingTest,
  onEvaluated,
  reel = [],
}) {
  // Output & execution
  const [outputTab, setOutputTab] = useState('decision');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);
  const [lastTrace, setLastTrace] = useState(null);
  const [lastParameters, setLastParameters] = useState(null);

  // Preset & form state
  const [preset, setPreset] = useState(autoPreset);
  const [policyQuery, setPolicyQuery] = useState('');

  // Transaction preset
  const [amount, setAmount] = useState('5000');
  const [txType, setTxType] = useState('transfer');
  const [acr, setAcr] = useState('');
  const [userId, setUserId] = useState('demoUser');

  // MCP preset
  const [toolName, setToolName] = useState('transfer');
  const [tokenAudience, setTokenAudience] = useState('mcpgateway.ping.demo');
  const [actClientId, setActClientId] = useState('d21c5124-8ac5-43d1-81f2-31a7ec649b96');
  const [mcpResourceUri, setMcpResourceUri] = useState('mcpgateway.ping.demo');
  const [hitlApproved, setHitlApproved] = useState(false);

  // Custom preset
  const [customRows, setCustomRows] = useState([
    { key: 'DecisionContext', value: 'McpToolCall' },
    { key: '', value: '' },
  ]);

  // Reel state
  const [activeReelId, setActiveReelId] = useState(null);

  const { policies } = policiesState;

  // Reset on endpoint/preset change
  useEffect(() => {
    setPreset(autoPreset);
    setResult(null);
    setErr(null);
    setLastTrace(null);
    setLastParameters(null);
    setActiveReelId(null);
    onClearPendingTest?.();
  }, [endpointId, autoPreset, onClearPendingTest]);

  // Apply pendingTest prefill
  useEffect(() => {
    if (!pendingTest) return;
    setPreset(pendingTest.preset);
    setResult(null);
    setErr(null);
    const p = pendingTest.parameters;
    if (pendingTest.preset === 'transaction') {
      if (p.Amount !== undefined) setAmount(String(p.Amount));
      if (p.TransactionType !== undefined) setTxType(p.TransactionType);
      if (p.Acr !== undefined) setAcr(p.Acr);
      if (p.UserId !== undefined) setUserId(p.UserId);
    } else if (pendingTest.preset === 'mcp') {
      if (p.ToolName !== undefined) setToolName(p.ToolName);
      if (p.TokenAudience !== undefined) setTokenAudience(p.TokenAudience);
      if (p.ActClientId !== undefined) setActClientId(p.ActClientId);
      if (p.McpResourceUri !== undefined) setMcpResourceUri(p.McpResourceUri);
      if (p.HitlApproved !== undefined) setHitlApproved(!!p.HitlApproved);
      if (p.UserId !== undefined) setUserId(p.UserId);
    } else {
      const rows = Object.entries(p).map(([key, value]) => ({ key, value: String(value) }));
      rows.push({ key: '', value: '' });
      setCustomRows(rows);
    }
  }, [pendingTest]);

  // Fetch MCP console defaults
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await bffAxios.get('/api/authorize/mcp-console-defaults');
        if (cancelled || !res.data) return;
        const d = res.data;
        if (d.actClientId) setActClientId(d.actClientId);
        if (d.tokenAudience) setTokenAudience(d.tokenAudience);
        if (d.mcpResourceUri) setMcpResourceUri(d.mcpResourceUri);
      } catch { /* keep static fallbacks */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build parameters from current form state
  const buildParameters = useCallback(() => {
    const ts = new Date().toISOString();
    if (preset === 'transaction') {
      return {
        Amount: Number(amount) || 0,
        TransactionType: txType,
        UserId: userId,
        ...(acr ? { Acr: acr } : {}),
        Timestamp: ts,
      };
    }
    if (preset === 'mcp') {
      return {
        DecisionContext: 'McpFirstTool',
        UserId: userId,
        ToolName: toolName,
        TokenAudience: tokenAudience,
        ActClientId: actClientId,
        McpResourceUri: mcpResourceUri,
        ...(hitlApproved ? { HitlApproved: true } : {}),
        Timestamp: ts,
      };
    }
    // custom
    const params = {};
    customRows.forEach(({ key, value }) => {
      const k = String(key || '').trim();
      if (k) params[k] = value;
    });
    return params;
  }, [preset, amount, txType, acr, userId, toolName, tokenAudience, actClientId, mcpResourceUri, hitlApproved, customRows]);

  // Execute with explicit parameters (allows replay)
  const runParameters = useCallback(async (parameters) => {
    setRunning(true);
    setResult(null);
    setErr(null);
    setLastTrace(null);
    setLastParameters(null);
    setOutputTab('decision');
    const started = Date.now();
    try {
      const res = await bffAxios.post('/api/authorize/evaluate-endpoint', {
        endpointId,
        parameters,
      });
      const elapsed = Date.now() - started;
      setLastParameters(parameters);
      setResult({ ...res.data, elapsedMs: elapsed });
      setLastTrace({
        timingsMs: elapsed,
        error: false,
      });
      onEvaluated?.({
        preset,
        decision: displayDecision(res.data),
        engine: res.data.engine,
        stepUpRequired: !!res.data.stepUpRequired,
        decisionId: res.data.decisionId,
      });
    } catch (e) {
      const elapsed = Date.now() - started;
      const message = e.response?.data?.message || e.response?.data?.error || e.message;
      setErr(message);
      setLastTrace({
        timingsMs: elapsed,
        error: true,
      });
    } finally {
      setRunning(false);
    }
  }, [endpointId, preset, onEvaluated]);

  // Execute with current form state
  const run = useCallback(() => {
    runParameters(buildParameters());
  }, [runParameters, buildParameters]);

  // Auto-run on pendingTest.autoRun
  useEffect(() => {
    if (!pendingTest?.autoRun || !endpointId) return;
    runParameters(pendingTest.parameters);
  }, [pendingTest, endpointId, runParameters]);

  // Custom row management
  const setRow = useCallback((i, field, val) => {
    setCustomRows(rows => {
      const next = rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r);
      const last = next[next.length - 1];
      if (last && (last.key || last.value)) next.push({ key: '', value: '' });
      return next;
    });
  }, []);

  const removeRow = useCallback((i) => {
    setCustomRows(rows => rows.filter((_, idx) => idx !== i));
  }, []);

  // Select a historical reel entry
  const selectReelEntry = useCallback((entry) => {
    if (!entry) return;
    // Restore form state from entry
    if (entry.preset === 'transaction') {
      setPreset('transaction');
      const p = entry.parameters;
      if (p.Amount !== undefined) setAmount(String(p.Amount));
      if (p.TransactionType !== undefined) setTxType(p.TransactionType);
      if (p.Acr !== undefined) setAcr(p.Acr);
      if (p.UserId !== undefined) setUserId(p.UserId);
    } else if (entry.preset === 'mcp') {
      setPreset('mcp');
      const p = entry.parameters;
      if (p.ToolName !== undefined) setToolName(p.ToolName);
      if (p.TokenAudience !== undefined) setTokenAudience(p.TokenAudience);
      if (p.ActClientId !== undefined) setActClientId(p.ActClientId);
      if (p.McpResourceUri !== undefined) setMcpResourceUri(p.McpResourceUri);
      if (p.HitlApproved !== undefined) setHitlApproved(!!p.HitlApproved);
      if (p.UserId !== undefined) setUserId(p.UserId);
    } else if (entry.preset === 'custom') {
      setPreset('custom');
      const rows = Object.entries(entry.parameters).map(([key, value]) => ({ key, value: String(value) }));
      rows.push({ key: '', value: '' });
      setCustomRows(rows);
    }
    // Restore result + trace
    setResult(entry.result);
    setLastParameters(entry.parameters);
    setLastTrace(entry.lastTrace);
    setOutputTab('decision');
    setActiveReelId(entry.id);
  }, []);

  // Computed
  const decision = useMemo(() => displayDecision(result), [result]);

  return {
    // Output & execution
    outputTab,
    setOutputTab,
    running,
    err,
    result,
    lastTrace,
    lastParameters,
    decision,

    // Preset & form
    preset,
    setPreset,
    policyQuery,
    setPolicyQuery,

    // Transaction fields
    amount,
    setAmount,
    txType,
    setTxType,
    acr,
    setAcr,
    userId,
    setUserId,

    // MCP fields
    toolName,
    setToolName,
    tokenAudience,
    setTokenAudience,
    actClientId,
    setActClientId,
    mcpResourceUri,
    setMcpResourceUri,
    hitlApproved,
    setHitlApproved,

    // Custom fields
    customRows,
    setCustomRows,
    setRow,
    removeRow,

    // Execution
    run,
    runParameters,
    buildParameters,

    // Reel
    activeReelId,
    setActiveReelId,
    selectReelEntry,
  };
}
