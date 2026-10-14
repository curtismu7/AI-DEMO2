// The floating agent's own Heuristics | llama.cpp choice, remembered per page path. No saved choice means the
// request carries no agentMode and the global agent mode decides, as before.
export const agentModeKey = (pathname) => `agentMode:agent:${pathname}`;

export function pageAgentModeField(pathname = typeof window !== 'undefined' ? window.location.pathname : '') {
  try {
    const mode = localStorage.getItem(agentModeKey(pathname));
    return mode === 'heuristics' || mode === 'llm' ? { agentMode: mode } : {};
  } catch {
    return {};
  }
}
