// Guards the client agent-mode SSOT (config/agentModes.js) against the two
// failure modes that caused the "llama.cpp only gives no response" bug:
//   1. Internal drift — the derived maps disagreeing with each other.
//   2. Client/server drift — the client table disagreeing with the server
//      resolver (demo_api_server/services/agentModeResolver.js), which is what
//      let the retired `ollama` mode linger client-side while the live mode was
//      `llamacpp`.
const fs = require("fs");
const path = require("path");

import {
  AGENT_MODES,
  CORE_MODE_IDS,
  MODE_PROVIDER,
  PURE_LLM_MODES,
  PURE_LLM_LABELS,
  DEFAULT_MODE,
} from "../agentModes";

describe("agentModes SSOT — internal consistency", () => {
  test("every derived map covers exactly the AGENT_MODES id set", () => {
    const ids = AGENT_MODES.map((m) => m.id);
    expect(CORE_MODE_IDS).toEqual(ids);
    expect(Object.keys(MODE_PROVIDER).sort()).toEqual([...ids].sort());
  });

  test("pure modes are exactly the modes with a provider (all but heuristics)", () => {
    const withProvider = AGENT_MODES.filter((m) => m.provider !== null).map((m) => m.id);
    expect([...PURE_LLM_MODES].sort()).toEqual([...withProvider].sort());
    expect(Object.keys(PURE_LLM_LABELS).sort()).toEqual([...withProvider].sort());
    // Regression guard for the actual bug: llama.cpp MUST be a pure LLM mode, or
    // a down llama.cpp fails silently instead of offering the Heuristics prompt.
    expect(PURE_LLM_MODES).toContain("llamacpp");
    expect(PURE_LLM_MODES).toContain("mlx");
    expect(PURE_LLM_MODES).not.toContain("ollama");
  });

  test("the default mode needs no provider (always answerable)", () => {
    expect(DEFAULT_MODE).toBe("heuristics");
    expect(MODE_PROVIDER[DEFAULT_MODE]).toBeNull();
  });
});

describe("agentModes SSOT — matches the server resolver", () => {
  // Parse the server's CORE_MODES table (the authoritative source) and compare
  // its id -> provider mapping to the client SSOT. Fails loudly on drift.
  const serverSrc = fs.readFileSync(
    path.resolve(__dirname, "../../../../demo_api_server/services/agentModeResolver.js"),
    "utf8",
  );

  const serverMap = {};
  const re = /\{\s*id:\s*'([^']+)',[^}]*provider:\s*(null|'([^']+)')[^}]*heuristicRouting/g;
  let m;
  while ((m = re.exec(serverSrc)) !== null) {
    serverMap[m[1]] = m[2] === "null" ? null : m[3];
  }

  test("parsed at least the six core modes from the server file", () => {
    expect(Object.keys(serverMap).length).toBeGreaterThanOrEqual(6);
    expect(serverMap).toHaveProperty("llamacpp", "llamacpp");
    expect(serverMap).toHaveProperty("mlx", "mlx");
    expect(serverMap).toHaveProperty("gemini", "google");
  });

  test("client id -> provider mapping equals the server's", () => {
    expect(MODE_PROVIDER).toEqual(serverMap);
  });
});
