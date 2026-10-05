import { doorName, doorsForMode, GATEWAY_MODES, LLM_PATHS, decideAfterSwitch, needsRearm, rearmReason, probeResultLabel } from "../privilegeRouting";

describe("doorName", () => {
  it("reads the door from facade and gateway URLs", () => {
    expect(doorName("https://api.ping.demo:3001/mcp-facade/opensearch/mcp")).toBe("opensearch");
    expect(doorName("https://gw.example/privilege-gateway/banking/mcp")).toBe("banking");
  });
  it("returns null for junk", () => {
    expect(doorName("not a url")).toBeNull();
    expect(doorName("")).toBeNull();
  });
});

describe("doorsForMode", () => {
  const presets = [
    { mode: "privilege", url: "https://gw.example/privilege-gateway/banking/mcp" },
    { mode: "privilege", url: "https://gw.example/privilege-gateway/other/mcp" },
    { mode: "direct", url: "https://api.ping.demo:3001/mcp-facade/opensearch/mcp" },
    { mode: "direct", url: "https://api.ping.demo:3001/mcp-facade/weird/mcp" },
    { mode: "facade", url: "https://api.ping.demo:3001/mcp-facade/banking/mcp" },
  ];
  it("returns only the selected mode's doors", () => {
    expect(doorsForMode(presets, "privilege")).toHaveLength(2);
    expect(doorsForMode(presets, "facade")).toEqual(["https://api.ping.demo:3001/mcp-facade/banking/mcp"]);
  });
  it("limits direct mode to the four direct door names", () => {
    expect(doorsForMode(presets, "direct")).toEqual(["https://api.ping.demo:3001/mcp-facade/opensearch/mcp"]);
  });
  it("returns [] for no presets or an unknown mode", () => {
    expect(doorsForMode([], "privilege")).toEqual([]);
    expect(doorsForMode(presets, "nope")).toEqual([]);
  });
});

describe("constants", () => {
  it("keeps the three MCP modes and three LLM paths", () => {
    expect(Object.keys(GATEWAY_MODES)).toEqual(["direct", "privilege", "facade"]);
    expect(Object.keys(LLM_PATHS)).toEqual(["anthropic", "google", "openai"]);
  });
});

describe("decideAfterSwitch", () => {
  it.each([
    // [kind, destinationAuthenticated, mode, forceReauth, signedIn, expected]
    ["path", true, "direct", false, true, "authenticated"],
    ["path", true, "direct", false, false, "authenticated"],
    ["path", false, "direct", false, true, "silent"],
    ["path", false, "direct", false, false, "manual"],
    ["path", true, "privilege", true, true, "forceReauth"],
    ["path", false, "privilege", true, false, "forceReauth"],
    ["door", false, "privilege", false, true, "silent"],
    ["door", false, "privilege", false, false, "manual"],
    ["door", false, "direct", false, true, "manual"],
    ["door", false, "facade", false, true, "manual"],
    ["door", true, "privilege", false, true, "authenticated"],
    ["door", true, "direct", false, false, "authenticated"],
  ])("%s dest=%s mode=%s force=%s signedIn=%s -> %s", (kind, destinationAuthenticated, mode, forceReauth, signedIn, expected) => {
    expect(decideAfterSwitch({ kind, destinationAuthenticated, mode, forceReauth, signedIn })).toBe(expected);
  });

  it("treats an undefined destinationAuthenticated as not authenticated", () => {
    expect(decideAfterSwitch({ kind: "door", destinationAuthenticated: undefined, mode: "privilege", signedIn: false })).toBe("manual");
  });
});

describe("needsRearm / rearmReason", () => {
  it("is true only for facade mode with a not-ready session", () => {
    expect(needsRearm("facade", { ready: false })).toBe(true);
    expect(needsRearm("facade", { ready: true })).toBe(false);
    expect(needsRearm("facade", null)).toBe(false);
    expect(needsRearm("privilege", { ready: false })).toBe(false);
    expect(needsRearm("direct", { ready: false })).toBe(false);
  });
  it("words the reason", () => {
    expect(rearmReason({ ready: false, reason: "expired" })).toBe("expired");
    expect(rearmReason({ ready: false })).toBe("not established");
    expect(rearmReason({ ready: false, reason: "other" })).toBe("not established");
  });
});

describe("probeResultLabel", () => {
  it("says the tool count for an ok door", () => {
    expect(probeResultLabel({ ok: true, tools: 3 })).toBe("3 tools");
  });
  it("joins status and error for a failed door, trimmed", () => {
    expect(probeResultLabel({ ok: false, status: 401, error: "Unauthorized" })).toBe("401 Unauthorized");
    expect(probeResultLabel({ ok: false, error: "boom" })).toBe("boom");
    expect(probeResultLabel({ ok: false, status: 502 })).toBe("502");
  });
  it("falls back to 'failed' when there is nothing to say", () => {
    expect(probeResultLabel({ ok: false })).toBe("failed");
  });
});
