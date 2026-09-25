import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPingOneSignals } from "../pingOneSignalsSdk";

function installSdk(data = "signals-payload") {
  const sdk = { init: vi.fn().mockResolvedValue(undefined), getData: vi.fn().mockResolvedValue(data) };
  window._pingOneSignals = sdk;
  window._pingOneSignalsReady = true;
  return sdk;
}

afterEach(() => {
  delete window._pingOneSignals;
  delete window._pingOneSignalsReady;
  delete window.__protectAuthSignalsInit;
  document.querySelectorAll('script[data-pingone-signals="protect-auth"]').forEach((script) => script.remove());
  vi.restoreAllMocks();
});

describe("collectPingOneSignals", () => {
  it("initializes the ready SDK and returns its signals payload", async () => {
    const sdk = installSdk();

    await expect(collectPingOneSignals()).resolves.toBe("signals-payload");
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.getData).toHaveBeenCalledTimes(1);
  });

  it("normalizes structured SDK data without losing the JSON payload", async () => {
    installSdk({ device: "trusted" });

    await expect(collectPingOneSignals()).resolves.toBe('{"device":"trusted"}');
  });

  it("surfaces SDK collection errors instead of returning empty data", async () => {
    const sdk = installSdk();
    sdk.getData.mockRejectedValue(new Error("signals failed"));

    await expect(collectPingOneSignals()).rejects.toThrow("signals failed");
  });
});
