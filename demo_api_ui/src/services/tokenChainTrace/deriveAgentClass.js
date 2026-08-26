// Which class of agent ran this trace — read off the token chain itself, not
// asserted by config. That is the point: the chain is the evidence.
//
//   worker     — a human was present when the token was minted, so the run
//                delegates: a user token is in the chain, or something in it
//                carries an `act` claim (RFC 8693).
//   autonomous — an agent identity ran with nobody to delegate from: agent
//                token present, no user token, no `act` anywhere.
//
// Returns null when the chain cannot prove either (no agent token yet, or an
// empty trace). Callers render nothing rather than guessing — a wrong class
// badge on an identity demo is worse than no badge.

const AGENT_TOKEN_IDS = ["agent-actor-token", "two-ex-agent-actor", "two-ex-mcp-actor"];

export function deriveAgentClass(tokenEvents) {
  const events = Array.isArray(tokenEvents) ? tokenEvents : [];
  if (!events.some((e) => AGENT_TOKEN_IDS.includes(e?.id))) return null;

  const delegated =
    events.some((e) => e?.id === "user-token") ||
    events.some((e) => e?.claims && e.claims.act);

  return delegated ? "worker" : "autonomous";
}

export const AGENT_CLASS_LABEL = {
  worker: "Worker",
  autonomous: "Autonomous",
};

export const AGENT_CLASS_TITLE = {
  worker: "Worker agent — a user was signed in, so the chain delegates (sub = user, act = agent).",
  autonomous: "Autonomous agent — ran unattended on its own identity (sub = agent, no act claim).",
};
