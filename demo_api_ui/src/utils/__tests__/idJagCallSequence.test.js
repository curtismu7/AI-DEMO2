import { ACTORS, CALLS, PHASES, actorById, nodesForCall } from "../idJagCallSequence";

describe("ID-JAG call sequence data", () => {
  it("numbers the calls 1..N with no gaps", () => {
    expect(CALLS.map((c) => c.n)).toEqual(CALLS.map((_, i) => i + 1));
    expect(CALLS).toHaveLength(19);
  });

  it("only names known actors and phases, in phase order", () => {
    for (const c of CALLS) {
      expect(actorById(c.from)).toBeTruthy();
      expect(actorById(c.to)).toBeTruthy();
      expect(PHASES).toContain(c.phase);
    }
    const order = CALLS.map((c) => PHASES.indexOf(c.phase));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("gives every call a label, a what-it-does text, a location and a source", () => {
    for (const c of CALLS) for (const k of ["label", "does", "where", "source"]) expect(String(c[k]).length).toBeGreaterThan(3);
  });

  it("marks only the hops that were not followed through the code", () => {
    expect(CALLS.filter((c) => c.traced === false).map((c) => c.n)).toEqual([14, 15]);
  });

  it("ties the two recorded events to the issue and redeem calls", () => {
    expect(CALLS.filter((c) => c.evidence).map((c) => [c.n, c.evidence])).toEqual([[8, "pf-id-jag-issued"], [12, "pf-id-jag-redeemed"]]);
  });

  it("never sends the ID-JAG past oauth-mcp", () => {
    const afterRedeem = CALLS.filter((c) => c.n > 12);
    for (const c of afterRedeem) expect(["oauthmcp"]).not.toContain(c.to);
    expect(CALLS.find((c) => c.n === 13).does).toMatch(/ID-JAG goes no further/);
  });

  it("maps actors onto implementation-page nodes", () => {
    expect(nodesForCall(CALLS[7])).toEqual(["bff", "pf"]);
    expect(nodesForCall(CALLS[11])).toEqual(["mcpas"]);
    expect(ACTORS.every((a) => a.node)).toBe(true);
  });
});
