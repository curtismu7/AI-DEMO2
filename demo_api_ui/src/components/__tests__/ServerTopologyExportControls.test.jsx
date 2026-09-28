import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServerTopologyExportControls from "../ServerTopologyExportControls";

describe("server topology export controls", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the browser print dialog for the current topology view", () => {
    window.print = vi.fn();
    render(<ServerTopologyExportControls />);

    fireEvent.click(screen.getByRole("button", { name: "Save as PDF" }));

    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("offers the full Lucidchart import CSV and its details inventory as downloads", () => {
    render(<ServerTopologyExportControls />);

    expect(screen.getByRole("link", { name: "Download Lucidchart CSV" })).toHaveAttribute(
      "href",
      "/exports/server-topology-lucidchart.csv",
    );
    expect(screen.getByRole("link", { name: "Download Lucidchart CSV" })).toHaveAttribute(
      "download",
      "server-topology-lucidchart.csv",
    );
    expect(screen.getByRole("link", { name: "Download details CSV" })).toHaveAttribute(
      "href",
      "/exports/server-topology-details.csv",
    );
    expect(screen.getByRole("link", { name: "Download details CSV" })).toHaveAttribute(
      "download",
      "server-topology-details.csv",
    );
  });
});
