/**
 * UC45 — SaaS-Embedded Agent — Website Worker. A customer signs in to a SaaS
 * website and asks its embedded Website Worker to act. Three identities stay
 * separate — website session, customer, worker — with mocked CIMD registration
 * supplying provenance and real RFC 8693 delegated execution through the
 * gateway and PingOne Authorize. The token chain keeps the customer as subject.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (customer)", sub: ["signs in to the SaaS site"], x: 40, y: 150, detail: "Her sign-in is the customer identity — the subject the delegated token keeps. The website session is a third thing, never conflated with either agent identity." },
  { id: "worker", group: "agent", label: "Website Worker", sub: ["embedded in the site", "own PingOne identity"], x: 340, y: 150, detail: "Embedded in the customer site but a distinct workload: its own PingOne AI Agent identity and its own CIMD/NHI association." },
  { id: "gw", group: "gateway", label: "BFF + Agent Gateway", sub: ["CIMD provenance", "RFC 8693"], x: 640, y: 150, detail: "The BFF verifies the worker (personal-agent-lookup), supplies CIMD/NHI provenance, and exchanges the customer authority for a delegated token." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["token exchange", "Authorize"], x: 940, y: 150, detail: "Mints the delegated token with the worker as actor, then Authorize evaluates customer, worker actor, scopes and tenant context." },
  { id: "tool", group: "resource", label: "Vertical resource", sub: ["redeem_miles"], x: 1240, y: 150, detail: "The vertical tool the worker acts on — redeem_miles in an airline-style vertical — reached only through the governed path." },
];

const EDGES = [
  ["user", "worker", "ask inside the site", { detail: "The ask happens inside the SaaS website — but the worker never borrows the customer's identity to satisfy it." }],
  ["worker", "gw", "worker identity + CIMD", { detail: "The BFF resolves the worker's distinct PingOne AI Agent identity and its mocked CIMD registration — provenance without conflating the website session." }],
  ["gw", "p1", "RFC 8693 exchange", { detail: "Real delegated execution: the customer's authority is exchanged for a token with sub=customer, act=worker, tenant context carried." }],
  ["p1", "tool", "gateway + Authorize", { detail: "Authorize evaluates the customer, the worker actor, scopes and tenant context before redeem_miles executes." }],
  ["tool", "user", "attribution intact", { detail: "The action completes and the token chain still names the customer as subject — three identities in, three identities out." }],
];

const walk = [
  {
    title: "The embedded ask", label: "Inside the SaaS site",
    nodes: ["user", "worker"], edges: [0],
    lines: [{ who: "Alice", text: "She asks the site's own worker for help — the worker will act under its own identity, for her." }],
    tech: [{ t: "API", c: "Website Worker action request (site-embedded, /embedded-worker)" }],
  },
  {
    title: "Worker identity resolved", label: "CIMD/NHI provenance",
    nodes: ["worker", "gw"], edges: [1],
    lines: [{ who: "BFF", text: "Website session, customer identity and worker identity stay separate — mocked CIMD registration supplies the worker's provenance." }],
    tech: [
      { t: "POLICY", c: "personal-agent-lookup: worker has its own PingOne AI Agent identity + CIMD/NHI association" },
      { t: "TOKEN", c: "CIMD registration supplies provenance (mocked facade, real association)" },
    ],
  },
  {
    title: "Delegated execution", label: "RFC 8693",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The exchange mints the delegated token: the customer stays the subject, the worker is the actor, tenant context rides along." }],
    tech: [{ t: "TOKEN", c: "RFC 8693 -> sub=customer, act={sub:website-worker}, tenant context" }],
  },
  {
    title: "Governed action", label: "gateway + Authorize",
    nodes: ["p1", "tool"], edges: [3],
    lines: [{ who: "PingOne", text: "Authorize evaluates customer, worker actor, scopes, tenant context and action policy before the tool runs." }],
    tech: [
      { t: "API", c: "POST /mcp tools/call redeem_miles  Bearer <delegated token>" },
      { t: "POLICY", c: "Authorize: customer + worker actor + scopes + tenant context -> PERMIT" },
    ],
  },
  {
    title: "Attribution intact", label: "sub=customer throughout",
    nodes: ["tool", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "The SaaS provider embeds a helpful agent without ever conflating the three identities — the chain proves it." }],
    tech: [{ t: "TOKEN", c: "chain: user-token -> personal-agent-lookup -> token-exchange -> tool-dispatched (sub=customer)" }],
  },
];

export default {
  id: "UC45",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
