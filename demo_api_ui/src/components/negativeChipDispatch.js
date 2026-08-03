// Generic negative-chip dispatch rail (Stage 0 negative-chip parity, Task 2).
//
// Pure orchestration module — no imports, all effects (network calls, message
// rendering) are dependency-injected so this can be unit-tested without
// mounting AIAgent.js (~6000+ lines, protected demo surface). AIAgent wires
// this in at the suggestion-chip click path: chips carrying `mode: 'direct'`
// plus a mapped synthetic `tool` or a `denyTool` (see Task 1's
// verticalSuggestionChips in agentChrome.js) skip the normal NL pipeline and
// dispatch here instead.
//
// Two negative-chip shapes:
//   - synthetic tool (e.g. test_wrong_audience/test_wrong_scope): these are
//     not real MCP tools — they map to an attack-sim id and are posted via
//     the injected `postSim`, which owns its own POST + verdict rendering
//     (mirrors the existing attack-sim POST + verdict-render pattern already
//     used elsewhere in AIAgent.js).
//   - denyTool (e.g. show_health_record called cross-vertical): a REAL MCP
//     tool call that is expected to be denied. A 403 with an authorization/
//     scope-denial error code is the control working as designed; a 2xx
//     means the control is broken; anything else (network/5xx/other errors)
//     falls through to a generic failure sentence. Response-shape reference:
//     the education-panel `authz_deny` branch (AIAgent.js:1208-1257),
//     parameterized here instead of hardcoded to one vertical/tool.

export const NEGATIVE_SIM_BY_TOOL = {
  test_wrong_audience: 'wrong-aud',
  test_wrong_scope: 'insufficient-scope',
};

export function isNegativeChip(chip) {
  if (!chip || chip.mode !== 'direct') return false;
  if (chip.tool && NEGATIVE_SIM_BY_TOOL[chip.tool]) return true;
  if (chip.denyTool) return true;
  return false;
}

export async function dispatchNegativeChip(chip, { vertical, callMcpTool, postSim, say } = {}) {
  say('user', chip.message);

  const sim = chip.tool && NEGATIVE_SIM_BY_TOOL[chip.tool];
  if (sim) {
    await postSim(sim, {
      vertical,
      useCaseId: chip.useCaseId || null,
      sourceLabel: chip.label,
    });
    return;
  }

  if (chip.denyTool) {
    try {
      await callMcpTool(chip.denyTool, {}, { vertical, useCaseId: chip.useCaseId || null });
      say('assistant', '⚠️ Expected a DENY but the call succeeded — this control is broken');
    } catch (err) {
      const status = err?.response?.status;
      const errorCode = err?.response?.data?.error;
      const decisionId = err?.response?.data?.decisionId;
      const isDeniedAsDesigned =
        status === 403 &&
        (errorCode === 'mcp_authorization_denied' || errorCode === 'mcp_scope_denied');
      if (isDeniedAsDesigned) {
        say('assistant', `Denied as designed — ${errorCode}, decision ${decisionId}`);
      } else {
        say('assistant', `Probe failed: ${err?.message || err?.code || 'request error'}`);
      }
    }
  }
}
