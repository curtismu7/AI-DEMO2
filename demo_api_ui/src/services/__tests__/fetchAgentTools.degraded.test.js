// demo_api_ui/src/services/__tests__/fetchAgentTools.degraded.test.js
import { fetchAgentTools } from "../demoAgentService";

describe("fetchAgentTools degraded passthrough", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("surfaces degraded + degradedReason from the response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        availableTools: [{ name: "get_my_accounts", permitted: true }],
        vertical: "banking",
        allowWrite: true,
        degraded: true,
        degradedReason: "discovery_unreachable",
      }),
    });
    const res = await fetchAgentTools({ vertical: "banking", allowWrite: true });
    expect(res.degraded).toBe(true);
    expect(res.degradedReason).toBe("discovery_unreachable");
    expect(res.availableTools[0].name).toBe("get_my_accounts");
  });
});
