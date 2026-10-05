import { doorName, doorsForMode, GATEWAY_MODES, LLM_PATHS } from "../privilegeRouting";

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
