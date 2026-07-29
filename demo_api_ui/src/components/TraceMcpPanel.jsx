// MCP-focused view for the Token Chain rail's "MCP" tab. Pure component:
// filters the pipeline steps to the delegation-to-MCP portion and surfaces the
// delegated token plus the FULL tool execution (request + response + raw
// payload, untruncated). No store access.
import React from "react";
import TraceStepCard from "./TraceStepCard";
import TraceTokenSummary from "./TraceTokenSummary";
import JsonHighlight from "./shared/JsonHighlight";
import { MCP_STEP_IDS } from "../services/tokenChainTrace/buildTraceSteps";

export default function TraceMcpPanel({ steps, trace, onInspect, useCase = null }) {
  const mcpSteps = MCP_STEP_IDS
    .map((id) => (steps || []).find((s) => s.id === id))
    .filter(Boolean);
  const mcp = trace && trace.mcpResult;

  // trace.mcpResult carries either the live SSE shape (toolName/duration/resultJson)
  // or the normalized shape (tool/durationMs/result) — accept both.
  const toolName = mcp && (mcp.toolName || mcp.tool);
  const durationMs = mcp && (mcp.durationMs != null ? mcp.durationMs : mcp.duration);
  const response = mcp && (mcp.resultJson != null ? mcp.resultJson
    : mcp.result != null ? mcp.result : mcp.resultSummary);

  const meta = mcp ? [
    ["tool", toolName],
    ["status", mcp.status != null ? String(mcp.status) : null],
    ["duration", durationMs != null ? `${durationMs} ms` : null],
    ["delegated", mcp.isDelegated != null ? String(mcp.isDelegated) : null],
    ["scopes", Array.isArray(mcp.scopes) ? mcp.scopes.join(" ") : null],
  ].filter(([, v]) => v != null) : [];

  return (
    <div className="tctr-mcp">
      <div className="tctr-sec-label">Delegated token</div>
      <TraceTokenSummary tokenEvents={trace.tokenEvents} onInspect={onInspect} only="mcp" />

      <div className="tctr-sec-label">Tool execution</div>
      {mcp ? (
        <div className="tctr-step-body">
          <div className="tctr-kv">
            {meta.map(([k, v]) => (
              <React.Fragment key={k}>
                <span className="tctr-kv-k">{k}</span>
                <span className="tctr-kv-v">{v}</span>
              </React.Fragment>
            ))}
          </div>
          <h4>Request</h4>
          <pre className="tctr-code"><JsonHighlight value={mcp.requestJson || { name: toolName }} /></pre>
          <h4>Response</h4>
          <pre className="tctr-code">{response != null ? <JsonHighlight value={response} /> : "(no response body)"}</pre>
          <h4>Raw payload</h4>
          <pre className="tctr-code"><JsonHighlight value={mcp} /></pre>
        </div>
      ) : (
        <div className="tctr-mcp-empty">No MCP tool call yet.</div>
      )}

      <div className="tctr-sec-label">MCP pipeline steps</div>
      {mcpSteps.map((step) => (
        <TraceStepCard key={step.id} step={step} onInspect={onInspect} defaultOpen useCase={useCase} />
      ))}
    </div>
  );
}
