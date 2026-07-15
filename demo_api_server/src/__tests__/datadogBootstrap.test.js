// demo_api_server/src/__tests__/datadogBootstrap.test.js
describe("datadogBootstrap", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
    jest.resetModules();
  });

  it("no-ops when DD_TRACE_ENABLED is unset", () => {
    delete process.env.DD_TRACE_ENABLED;
    delete process.env.DD_API_KEY;
    const { bootstrapDatadog } = require("../../services/datadogBootstrap");
    expect(bootstrapDatadog()).toEqual({
      enabled: false,
      reason: "DD_TRACE_ENABLED not true",
    });
  });

  it("no-ops when enabled but API key missing", () => {
    process.env.DD_TRACE_ENABLED = "true";
    delete process.env.DD_API_KEY;
    const { bootstrapDatadog } = require("../../services/datadogBootstrap");
    expect(bootstrapDatadog().enabled).toBe(false);
    expect(bootstrapDatadog().reason).toMatch(/DD_API_KEY/);
  });
});
