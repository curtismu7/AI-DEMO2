// agentStudioMockStore.js
// Shared, client-only mock store for the "Agent Studio (Preview)" pages —
// Agent Studio, Discovery, IGA for AI, and Privileges Gateway all read/write
// this same store so completing a flow in one page is visible in another.
// localStorage-backed so state survives a refresh within a demo session.
// Not connected to any backend — this is a simulated 1-year-target preview.
// Spec: docs/superpowers/specs/2026-07-13-agent-studio-preview-design.md

const STORAGE_KEY = "aiDemo.agentStudioPreview.v1";

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {
    // ignore malformed/blocked storage
  }
  return { agents: [] };
}

function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {
    // ignore quota/blocked storage
  }
}

let state = loadState();
const listeners = new Set();

function notify() {
  saveState(state);
  listeners.forEach((fn) => fn(state));
}

export const agentStudioMockStore = {
  getState() {
    return state;
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Register an agent created via an Agent Studio flow (already governed). */
  registerAgent({ name, persona, mcpCount }) {
    const agent = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      persona,
      source: "Agent Studio",
      owner: "auto-assigned",
      mcpCount,
      status: "governed",
      lastCertified: null,
    };
    state = { ...state, agents: [...state.agents, agent] };
    notify();
    return agent;
  },

  /** Record an unmanaged agent surfaced by a Discovery flow (pending review). */
  addDiscovered({ name, source, detectedAt }) {
    const agent = {
      id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      persona: "Discovered",
      source,
      owner: "unassigned",
      mcpCount: 0,
      status: "pending",
      detectedAt,
      lastCertified: null,
    };
    state = { ...state, agents: [...state.agents, agent] };
    notify();
    return agent;
  },

  /** Admin approves a pending-review discovered agent into governance. */
  approveAgent(id) {
    state = {
      ...state,
      agents: state.agents.map((a) =>
        a.id === id ? { ...a, status: "governed", owner: "security-admin" } : a,
      ),
    };
    notify();
  },

  /** IGA certifies a governed agent. */
  certifyAgent(id) {
    state = {
      ...state,
      agents: state.agents.map((a) =>
        a.id === id
          ? { ...a, status: "certified", lastCertified: new Date().toISOString().slice(0, 10) }
          : a,
      ),
    };
    notify();
  },

  reset() {
    state = { agents: [] };
    notify();
  },
};
