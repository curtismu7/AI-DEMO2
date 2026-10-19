import { describe, expect, it } from "vitest";
import { PLAYBACKS, SERVER_EDGES } from "../../components/serverTopologyData";
import { KINDS, formFor, noTokenNote, refsFor, tokensFor } from "../serverTopologyStandards";

const edgeIds = new Set(SERVER_EDGES.map((e) => e.id));
const EXCHANGE_EDGES = ["nodegw-pingone", "mcpmcp-pingone-step9", "mcpmcp-pingfederate-step9"];

describe("server topology standards, forms and mock tokens", () => {
  it("only talks about edges that exist", () => {
    const ids = [...SERVER_EDGES.map((e) => e.id)];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(refsFor(id)).toBeInstanceOf(Array);
      expect(formFor(id) === null || typeof formFor(id) === "string").toBe(true);
    }
    // an unknown id yields nothing rather than a guess
    expect(refsFor("no-such-edge")).toEqual([]);
    expect(formFor("no-such-edge")).toBeNull();
    expect(tokensFor("no-such-edge")).toEqual([]);
  });

  it("gives every playback step standards behind it", () => {
    for (const [key, flow] of Object.entries(PLAYBACKS)) {
      for (const step of flow.steps) {
        expect(edgeIds.has(step.edgeId), `${key}: ${step.edgeId}`).toBe(true);
        expect(refsFor(step.edgeId).length, `${key}: ${step.edgeId} has no standards`).toBeGreaterThan(0);
      }
    }
  });

  it("every standards entry has a kind, an id and a title, with no duplicates per step", () => {
    for (const { id: edgeId } of SERVER_EDGES) {
      const refs = refsFor(edgeId);
      for (const ref of refs) {
        expect(KINDS, `${edgeId}: ${ref.id}`).toContain(ref.kind);
        expect(ref.id).toBeTruthy();
        expect(ref.title).toBeTruthy();
        if (ref.kind === "rfc") expect(ref.id).toMatch(/RFC \d+/);
        if (ref.kind === "emerging") expect(ref.id).not.toMatch(/^RFC \d+$/);
      }
      expect(new Set(refs.map((r) => r.id)).size).toBe(refs.length);
    }
  });

  it("marks emerging work on the token-exchange steps and keeps RFC 8693 as a published reference", () => {
    for (const id of EXCHANGE_EDGES) {
      const refs = refsFor(id);
      expect(refs.some((r) => r.kind === "rfc" && r.id === "RFC 8693"), id).toBe(true);
      expect(refs.some((r) => r.kind === "emerging"), id).toBe(true);
    }
  });

  it("shows two tokens where a step takes one in and issues another, and says why when there is none", () => {
    for (const id of EXCHANGE_EDGES) expect(tokensFor(id)).toHaveLength(2);
    for (const { id } of SERVER_EDGES) {
      for (const token of tokensFor(id)) {
        expect(token.label).toBeTruthy();
        expect(token.claims && typeof token.claims).toBe("object");
        expect(JSON.stringify(token)).not.toMatch(/eyJ|Bearer [A-Za-z0-9]{20,}|secret/i);
      }
    }
    const telemetry = SERVER_EDGES.find((e) => e.data.kind === "telemetry");
    expect(tokensFor(telemetry.id)).toEqual([]);
    expect(noTokenNote(telemetry)).toMatch(/No user token/);
  });

  it("gives the HTTP and protocol calls of the main flows a request form", () => {
    for (const id of ["bff-pingone-token", "nodegw-pingone", "nodegw-authz", "bff-nodegw", "mcpmcp-bff-api", "nodegw-apiresource-apikey", "browser-pingone-login"]) {
      expect(formFor(id), id).toBeTruthy();
    }
    expect(formFor("nodegw-apiresource-apikey")).toMatch(/X-API-Key/);
  });
});
