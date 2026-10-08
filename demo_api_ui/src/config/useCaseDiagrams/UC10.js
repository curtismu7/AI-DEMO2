/**
 * UC10 — Resource-ownership / account takeover (DENY). A valid, scoped,
 * properly delegated token aimed at someone else's account: Authorize matches
 * the resource owner to the token subject and denies. Ownership lives in
 * policy, not app code.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "atk", group: "external", label: "Attack agent", sub: ["other user's acct"], x: 40, y: 150, detail: "Holds a real delegated token — scopes fine, delegation fine — and aims it at another user's account." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["asks the PDP"], x: 340, y: 150, detail: "Ownership is not checked in application code; the gateway asks the policy decision point." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["owner vs subject"], x: 640, y: 150, detail: "Binds the resource to the token subject: this account belongs to someone else." },
];

const EDGES = [
  ["atk", "gw", "read other account", { detail: "The call looks perfectly legitimate on every axis but ownership." }],
  ["gw", "p1", "authorize", { detail: "The policy compares resource owner against token subject." }],
  ["p1", "gw", "DENY", { detail: "Owner mismatch: no data returns." }],
  ["gw", "atk", "stopped", { detail: "The gateway halts the call before anything crosses back." }],
];

const walk = [
  {
    title: "Valid token, wrong target", label: "Everything fine but one thing",
    nodes: ["atk", "gw"], edges: [0],
    lines: [{ who: "Attacker", text: "Delegated, scoped, unexpired — aimed at account it does not own." }],
    tech: [{ t: "TOKEN", c: "AT: sub=alice (delegated), target account owner=bob" }],
  },
  {
    title: "Gateway asks policy", label: "Not an app-code check",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "Ownership binds in policy; applications never wrote an owner check." }],
    tech: [{ t: "POLICY", c: "Authorize: resource.owner vs token.sub" }],
  },
  {
    title: "DENY", label: "Owner mismatch",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "PingOne", text: "Even a valid, scoped, properly delegated token is denied on the mismatch." }],
    tech: [{ t: "POLICY", c: "owner(bob) != sub(alice) -> DENY" }],
  },
  {
    title: "No data returned", label: "Stopped at the gateway",
    nodes: ["gw", "atk"], edges: [3],
    lines: [{ who: "Gateway", text: "No record, no balance — nothing crossed back over the wire." }],
    tech: [{ t: "API", c: "gateway halts call; authorize-decision DENY recorded" }],
  },
];

export default {
  id: "UC10",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
