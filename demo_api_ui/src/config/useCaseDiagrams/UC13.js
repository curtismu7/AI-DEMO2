/**
 * UC13 — Confused-deputy actor injection (DENY). A rogue agent injects itself
 * as the acting party. Actor identity comes from the native act claim PingOne
 * stamped at a real token exchange — never a request header — so the forgery
 * dies at the actor check.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "rogue", group: "external", label: "Rogue agent", sub: ["forges act header"], x: 40, y: 150, detail: "Tries to become the acting party by injecting itself into the delegation chain — headers are easy to forge." },
  { id: "pipe", group: "gateway", label: "Full pipeline", sub: ["runs anyway"], x: 340, y: 150, detail: "Token exchange, Authorize, Agent Gateway — the system treats it like any other call." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["actor check"], x: 640, y: 150, detail: "The native act claim was stamped at exchange time; a header cannot rewrite what the AS signed." },
];

const EDGES = [
  ["rogue", "pipe", "forged call", { detail: "The claimed actor is injected in a header." }],
  ["pipe", "p1", "evaluate", { detail: "The full pipeline runs; nothing is shortcut." }],
  ["p1", "p1", "native claim", { detail: "The act claim was stamped by PingOne at a real exchange — not request-supplied." }],
  ["p1", "pipe", "DENY", { detail: "act in the token does not match the claimed actor." }],
  ["pipe", "rogue", "refused", { detail: "The audience sees the Authorize DENY end to end." }],
];

const walk = [
  {
    title: "Forgery attempted", label: "Header injection",
    nodes: ["rogue", "pipe"], edges: [0],
    lines: [{ who: "Rogue agent", text: "Claims the acting-party role in a header — the confused-deputy move." }],
    tech: [{ t: "API", c: "request carries forged act/actor header" }],
  },
  {
    title: "Pipeline runs", label: "No shortcut",
    nodes: ["pipe", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "The call goes through the whole governed path — which is where it dies." }],
    tech: [{ t: "POLICY", c: "token exchange + authorize evaluation proceed normally" }],
  },
  {
    title: "Native claim wins", label: "Stamped at exchange",
    nodes: ["p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The real actor was set by PingOne at exchange time. Headers lie; claims do not." }],
    tech: [{ t: "TOKEN", c: "act={...} minted by PingOne at RFC 8693 exchange (not request-supplied)" }],
  },
  {
    title: "DENY", label: "Actor check fails",
    nodes: ["p1", "pipe"], edges: [3],
    lines: [{ who: "PingOne", text: "The acting party in the token is not the claimed one." }],
    tech: [{ t: "POLICY", c: "Authorize actor check: token act != claimed actor -> DENY" }],
  },
  {
    title: "Cannot be spoofed", label: "What the audience sees",
    nodes: ["pipe", "rogue"], edges: [4],
    lines: [{ who: "Presenter", text: "Even a compromised internal service that can forge headers cannot forge the claim." }],
    tech: [{ t: "POLICY", c: "authorize-decision: DENY visible in chat + chain" }],
  },
];

export default {
  id: "UC13",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
