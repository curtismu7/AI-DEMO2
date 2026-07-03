// MCP-focused view for the Token Chain rail's "MCP" tab. Pure component:
// filters the pipeline steps to the delegation-to-MCP portion and surfaces the
// delegated token plus the FULL tool execution (request + response + raw
// payload, untruncated). No store access.
import React from "react";
import TraceStepCard from "./TraceStepCard";
import TraceTokenSummary from "./TraceTokenSummary";

export const MCP_STEP_IDS = ["exchange", "gateway", "mcp", "api"];

const asJson = (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };

export default function TraceMcpPanel({ steps, trace, onInspect }) {
  const mcpSteps = MCP_STEP_IDS
    .map((id) => (steps || []).find((s) => s.id === id))
    .filter(Boolean);
  const mcp = trace && trace.mcpResult;

  const toolName = mcp && (mcp.toolName || mcp.tool);
  const durationMs = mcp && (mcp.durationMs != null ? mcp.durationMs : mcp.duration);
  const response = mcp && (mcp.resultJson != null ? mcp.resultJson
    : mcp.result != null ? mcp.result : mcp.resultSummary);

  return (
    <div className="tctr-mcp">
      <div className="tctr-sec-label">Delegated token</div>
      <TraceTokenSummary tokenEvents={trace.tokenEvents} onInspect={onInspect} only="mcp" />

      <div className="tctr-sec-label">Tool execution</div>
      {mcp ? (
        <div className="tctr-step-body">
          <div className="tctr-kv">
            {toolName != null && (<><span className="tctr-kv-k">tool</span><span className="tctr-kv-v">{toolName}</span></>)}
            {mcp.status != null && (<><span className="tctr-kv-k">status</span><span className="tctr-kv-v">{String(mcp.status)}</span></>)}
            {durationMs != null && (<><span className="tctr-kv-k">duration</span><span className="tctr-kv-v">{durationMs} ms</span></>)}
            {mcp.isDelegated != null && (<><span className="tctr-kv-k">delegated</span><span className="tctr-kv-v">{String(mcp.isDelegated)}</span></>)}
            {Array.isArray(mcp.scopes) && (<><span className="tctr-kv-k">scopes</span><span className="tctr-kv-v">{mcp.scopes.join(" ")}</span></>)}
          </div>
          <h4>Request</h4>
          <pre className="tctr-code">{asJson(mcp.requestJson || { name: toolName })}</pre>
          <h4>Response</h4>
          <pre className="tctr-code">{response != null ? asJson(response) : "(no response body)"}</pre>
          <h4>Raw payload</h4>
          <pre className="tctr-code">{asJson(mcp)}</pre>
        </div>
      ) : (
        <div className="tctr-mcp-empty">No MCP tool call yet.</div>
      )}

      <div className="tctr-sec-label">MCP pipeline steps</div>
      {mcpSteps.map((step) => (
        <TraceStepCard key={step.id} step={step} onInspect={onInspect} defaultOpen />
      ))}
    </div>
  );
}
