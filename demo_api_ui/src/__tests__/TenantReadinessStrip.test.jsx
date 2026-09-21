import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVENANCE } from "../learning/provenance";
import TenantReadinessStrip from "../components/learning/TenantReadinessStrip";

const readySnapshot = {
  environment: {
    provenance: PROVENANCE.LIVE_CLOUD,
    label: "Verified cloud services with local dependencies",
  },
  dependencies: [
    {
      id: "pingone",
      label: "PingOne",
      status: "available",
      provenance: PROVENANCE.LIVE_CLOUD,
      detail: "Cloud endpoint verified",
    },
    {
      id: "authorize",
      label: "Authorize",
      status: "available",
      provenance: PROVENANCE.LIVE_CLOUD,
      detail: "Live policy engine",
    },
    {
      id: "davinci",
      label: "DaVinci",
      status: "not-enabled",
      provenance: PROVENANCE.RECORDED,
      detail: "Orchestration flag is off",
    },
    {
      id: "privilege",
      label: "Privilege",
      status: "not-enabled",
      provenance: PROVENANCE.RECORDED,
      detail: "Privilege flags are off",
    },
    {
      id: "mcp",
      label: "MCP",
      status: "available",
      provenance: PROVENANCE.LIVE_LOCAL,
      detail: "Gateway and server reachable",
    },
    {
      id: "vertical",
      label: "Selected vertical",
      status: "available",
      provenance: PROVENANCE.LIVE_LOCAL,
      detail: "banking",
    },
  ],
  lastCheckedAt: "2026-09-20T12:00:00.000Z",
  ready: true,
  warnings: [],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("TenantReadinessStrip", () => {
  it("renders every dependency with explicit provenance", async () => {
    const loadReadiness = vi.fn().mockResolvedValue(readySnapshot);

    render(
      <TenantReadinessStrip loadReadiness={loadReadiness} pollIntervalMs={0} />,
    );

    expect(await screen.findByText("Tenant ready")).toBeInTheDocument();
    expect(
      screen.getByText("Verified cloud services with local dependencies"),
    ).toBeInTheDocument();
    for (const dependency of readySnapshot.dependencies) {
      expect(screen.getByText(dependency.label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("LIVE CLOUD")).toHaveLength(2);
    expect(screen.getAllByText("LIVE LOCAL")).toHaveLength(2);
    expect(screen.getAllByText("RECORDED")).toHaveLength(2);
    expect(screen.getByText("Checked 12:00:00 PM")).toBeInTheDocument();
  });

  it("polls readiness and replaces the displayed snapshot", async () => {
    vi.useFakeTimers();
    const loadReadiness = vi
      .fn()
      .mockResolvedValueOnce({
        ...readySnapshot,
        ready: false,
        warnings: ["Cloud not verified."],
      })
      .mockResolvedValueOnce(readySnapshot);

    render(
      <TenantReadinessStrip
        loadReadiness={loadReadiness}
        pollIntervalMs={1000}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Cloud not verified.")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await waitFor(() => expect(loadReadiness).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Tenant ready")).toBeInTheDocument();
    expect(screen.queryByText("Cloud not verified.")).not.toBeInTheDocument();
  });

  it("surfaces a safe warning when readiness cannot be loaded", async () => {
    const loadReadiness = vi
      .fn()
      .mockRejectedValue(new Error("Bearer super-secret"));

    render(
      <TenantReadinessStrip loadReadiness={loadReadiness} pollIntervalMs={0} />,
    );

    expect(
      await screen.findByText("Readiness unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tenant readiness could not be checked."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/super-secret/i)).not.toBeInTheDocument();
  });
});
