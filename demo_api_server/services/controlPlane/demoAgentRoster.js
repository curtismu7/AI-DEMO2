'use strict';

// Seeded demo identities representing other AI platforms. These are NOT real
// PingOne apps — stopping them writes a real audit record but does not call
// PingOne disable (there is no real user/app behind them).
const DEMO_AGENTS = [
  { id: 'chatgpt', platform: 'ChatGPT', label: 'ChatGPT' },
  { id: 'copilot', platform: 'Copilot Studio', label: 'Copilot Studio' },
  { id: 'glean', platform: 'Glean', label: 'Glean' },
  { id: 'agentforce', platform: 'Agentforce', label: 'Agentforce' },
  { id: 'servicenow', platform: 'ServiceNow', label: 'ServiceNow' },
];

function seed() {
  return DEMO_AGENTS.map((a) => ({ ...a, status: 'active' }));
}

function getRoster(req) {
  if (!req.session) req.session = {};
  if (!Array.isArray(req.session.demo_agent_roster)) {
    req.session.demo_agent_roster = seed();
  }
  return req.session.demo_agent_roster;
}

function setStatus(req, id, status) {
  const list = getRoster(req);
  const entry = list.find((a) => a.id === id);
  if (!entry) return null;
  entry.status = status;
  return entry;
}

function reset(req) {
  req.session.demo_agent_roster = seed();
  return req.session.demo_agent_roster;
}

module.exports = { DEMO_AGENTS, getRoster, setStatus, reset };
