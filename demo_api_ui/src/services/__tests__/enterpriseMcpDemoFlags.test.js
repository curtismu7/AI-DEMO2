import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../apiClient", () => ({
  default: { get: vi.fn(), patch: vi.fn() },
}));

import apiClient from "../apiClient";
import {
  DEMO_FLAG_ID,
  armEnterpriseMcpDemo,
  resetEnterpriseMcpDemo,
  readEnterpriseMcpDemoState,
} from "../enterpriseMcpDemoFlags";

function flagsResponse(value) {
  return { data: { flags: [{ id: DEMO_FLAG_ID, value }] } };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.patch.mockResolvedValue({ data: {} });
});

describe("arming", () => {
  it("turns the demo flag on", async () => {
    apiClient.get.mockResolvedValue(flagsResponse(false));
    await armEnterpriseMcpDemo();

    expect(apiClient.patch).toHaveBeenCalledWith(
      "/api/admin/feature-flags",
      { updates: { [DEMO_FLAG_ID]: true } },
    );
  });

  it("touches ONLY the enterprise flag — never any other", async () => {
    apiClient.get.mockResolvedValue(flagsResponse(false));
    await armEnterpriseMcpDemo();

    const [, body] = apiClient.patch.mock.calls[0];
    expect(Object.keys(body.updates)).toEqual([DEMO_FLAG_ID]);
  });

});

describe("reset", () => {
  it("turns the flag OFF regardless of what it was before", async () => {
    // Always off, never "back to whatever it was": a presenter who already had
    // the flag on would otherwise click Reset and see nothing change.
    for (const before of [true, false]) {
      apiClient.patch.mockClear();
      apiClient.get.mockResolvedValue(flagsResponse(before));
      await resetEnterpriseMcpDemo();
      expect(apiClient.patch).toHaveBeenCalledWith(
        "/api/admin/feature-flags",
        { updates: { [DEMO_FLAG_ID]: false } },
      );
    }
  });

  it("touches ONLY the enterprise flag", async () => {
    await resetEnterpriseMcpDemo();
    const [, body] = apiClient.patch.mock.calls[0];
    expect(Object.keys(body.updates)).toEqual([DEMO_FLAG_ID]);
  });
});

describe("reading state", () => {
  it("reports armed when the flag is on", async () => {
    apiClient.get.mockResolvedValue(flagsResponse(true));
    expect(await readEnterpriseMcpDemoState()).toBe(true);
  });

  it("reports not-armed when the flag is off", async () => {
    apiClient.get.mockResolvedValue(flagsResponse(false));
    expect(await readEnterpriseMcpDemoState()).toBe(false);
  });

  it("reports not-armed rather than throwing when the read fails", async () => {
    apiClient.get.mockRejectedValue(new Error("offline"));
    expect(await readEnterpriseMcpDemoState()).toBe(false);
  });

  it("treats the string 'true' as armed — the API returns strings", async () => {
    apiClient.get.mockResolvedValue(flagsResponse("true"));
    expect(await readEnterpriseMcpDemoState()).toBe(true);
  });
});
