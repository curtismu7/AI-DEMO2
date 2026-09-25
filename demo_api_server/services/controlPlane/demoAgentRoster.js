'use strict';

// No simulated platform identities: every row the control plane shows must
// have a real PingOne identity behind it, so this roster is empty. The only
// real stoppable agent is the live row built by liveAgentInfo.js. Kept as an
// empty seeded list so the session-scoped store, stop/reset endpoints and the
// registry's runtime-agent union keep working unchanged.
const DEMO_AGENTS = [];

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
