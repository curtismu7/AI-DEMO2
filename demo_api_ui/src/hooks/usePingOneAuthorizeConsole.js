import { useState, useEffect, useCallback, useRef } from 'react';
import bffAxios from '../services/bffAxios';
import { displayDecision } from '../utils/authorizeResultExplain';

/**
 * usePingOneAuthorizeConsole — unified state + logic for the P1AZ console tab.
 * Consolidates all form state, policy evaluation, run history (reel), and replay.
 */
export function usePingOneAuthorizeConsole({
  endpointId,
  autoPreset,
  defaultToolName = 'transfer',
  defaultAmount = '5000',
  pendingTest,
  onClearPendingTest,
  onEvaluated,
  defaultMode = 'mock',
}) {
  const [running, setRunning] = useState(false);
  // 'live' sends to PingOne Authorize; 'mock' (the default) is answered by the server's built-in simulated engine (no PingOne call).
  const [mode, setMode] = useState(defaultMode);

  // Preset & form state
  const [preset, setPreset] = useState(autoPreset);

  // Transaction preset
  const [amount, setAmount] = useState(defaultAmount);
  const [txType, setTxType] = useState('transfer');
  const [acr, setAcr] = useState('');
  const [userId, setUserId] = useState('demoUser');

  // MCP preset
  const [toolName, setToolName] = useState(defaultToolName);
  const [tokenAudience, setTokenAudience] = useState('mcpgateway.ping.demo');
  const [actClientId, setActClientId] = useState('d21c5124-8ac5-43d1-81f2-31a7ec649b96');
  const [mcpResourceUri, setMcpResourceUri] = useState('mcpgateway.ping.demo');
  const [hitlApproved, setHitlApproved] = useState(false);

  // Custom preset
  const [customRows, setCustomRows] = useState([
    { key: 'DecisionContext', value: 'McpToolCall' },
    { key: '', value: '' },
  ]);

  // Reset on endpoint/preset change
  useEffect(() => {
    setPreset(autoPreset);
    onClearPendingTest?.();
  }, [endpointId, autoPreset, onClearPendingTest]);

  // Apply pendingTest prefill
  useEffect(() => {
    if (!pendingTest) return;
    // A hand-off (Token Chain replay, a staged test) re-sends a request a real run made: it goes to PingOne, not the simulator.
    setMode('live');
    setPreset(pendingTest.preset);
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
  // `usedPreset` lets Resend re-run a call under the preset it was made with.
  // `useMode` lets a hand-off run on 'live' in the same render that switches the console to it.
  const runParameters = useCallback(async (parameters, usedPreset = preset, useMode = mode) => {
    setRunning(true);
    const started = Date.now();
    try {
      const res = await bffAxios.post('/api/authorize/evaluate-endpoint', {
        endpointId,
        parameters,
        ...(useMode === 'mock' ? { mode: 'mock' } : {}),
      });
      const elapsed = Date.now() - started;
      onEvaluated?.({
        preset: usedPreset,
        decision: displayDecision(res.data),
        engine: res.data.engine,
        stepUpRequired: !!res.data.stepUpRequired,
        decisionId: res.data.decisionId,
        result: res.data,
        parameters,
        elapsedMs: elapsed,
      });
    } catch (e) {
      const elapsed = Date.now() - started;
      const message = e.response?.data?.message || e.response?.data?.error || e.message;
      onEvaluated?.({ preset: usedPreset, error: message, parameters, elapsedMs: elapsed });
    } finally {
      setRunning(false);
    }
  }, [endpointId, preset, mode, onEvaluated]);

  // Execute with current form state
  const run = useCallback(() => {
    runParameters(buildParameters());
  }, [runParameters, buildParameters]);

  // Auto-run on pendingTest.autoRun, once per staged replay (runParameters changes with the preset).
  const consumedRef = useRef(null);
  useEffect(() => {
    if (!pendingTest?.autoRun || !endpointId || consumedRef.current === pendingTest) return;
    consumedRef.current = pendingTest;
    runParameters(pendingTest.parameters, pendingTest.preset, 'live');
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

  return {
    running,
    mode,
    setMode,

    // Preset & form
    preset,
    setPreset,

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
  };
}
