/**
 * UC-OBO — RFC 8693 delegation on PingOne, the on-behalf-of inspector.
 * The BFF holds the person's token, gets the agent's own token with client
 * credentials, and exchanges the pair for a delegated token (sub = person,
 * act = agent). The model, when Claude Code is the client, sees only the result.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Person", sub: ["signed in"], x: 40, y: 150, detail: "Signed in to the app. Their token stays in the BFF session; the browser and the model never receive it." },
  { id: "bff", group: "gateway", label: "BFF", sub: ["holds the user token"], x: 340, y: 150, detail: "Runs the exchange from the signed-in session as the Token Exchanger app, then calls the downstream resource with the delegated token." },
  { id: "p1", group: "external", label: "PingOne", sub: ["authorization server"], x: 640, y: 150, detail: "Issues the agent's token and performs the RFC 8693 exchange. The resource attribute adds act = {client_id} of the actor." },
  { id: "agent", group: "agent", label: "AI Agent client", sub: ["the actor"], x: 640, y: 340, detail: "A client with its own credentials and scope agent:invoke. It is the party the delegated token says is acting." },
];

const EDGES = [
  ["user", "bff", "signed-in session", { detail: "The user token is the subject token; it never leaves the server." }],
  ["agent", "p1", "client credentials", { detail: "The agent authenticates as itself; this token is the actor token." }],
  ["bff", "p1", "token exchange", { detail: "subject_token = user token, actor_token = agent token, audience obo-demo.ping.demo, scope obo:invoke." }],
  ["p1", "bff", "delegated token", { detail: "sub = the person, act = the agent. Delegation, not impersonation." }],
];

const walk = [
  {
    title: "Subject token", label: "signed-in session",
    nodes: ["user", "bff"], edges: [0],
    lines: [{ who: "BFF", text: "I already hold the person's token from their session. It is the subject." }],
    tech: [{ t: "API", c: "POST /api/obo/run (session cookie) or POST /api/obo/mcp (Claude Code MCP tool act_on_my_behalf)" }],
  },
  {
    title: "Actor token", label: "client credentials",
    nodes: ["agent", "p1"], edges: [1],
    lines: [{ who: "Agent", text: "I authenticate as myself. This is the actor token." }],
    tech: [{ t: "API", c: "POST /token grant_type=client_credentials&scope=agent:invoke (AI Agent client)" }],
  },
  {
    title: "Exchange", label: "token exchange",
    nodes: ["bff", "p1"], edges: [2],
    lines: [{ who: "BFF", text: "Here is the person's token and the agent's — issue a narrow token for this resource." }],
    tech: [
      { t: "API", c: "POST /token grant_type=urn:ietf:params:oauth:grant-type:token-exchange&subject_token=…&actor_token=…&audience=obo-demo.ping.demo&scope=obo:invoke (Token Exchanger app)" },
      { t: "POLICY", c: "act is an object only via the resource attribute ${{'client_id': #root.context.requestData.actorToken.client_id}}" },
    ],
  },
  {
    title: "Delegated token", label: "delegated token",
    nodes: ["p1", "bff"], edges: [3],
    lines: [{ who: "PingOne", text: "Here is a token for the person that names the agent as the actor." }],
    tech: [
      { t: "TOKEN", c: "sub = person, act = {client_id: agent}, aud = obo-demo.ping.demo, scope = obo:invoke" },
      { t: "API", c: "GET /api/obo/downstream with the delegated token; seven checks confirm delegation, not impersonation" },
    ],
  },
];

export default {
  id: "UC-OBO",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
