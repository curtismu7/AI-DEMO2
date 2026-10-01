import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const get = vi.fn();
const put = vi.fn();
vi.mock("../../services/apiClient", () => ({ default: { get: (...a) => get(...a), put: (...a) => put(...a) } }));
vi.mock("../../utils/appToast", () => ({ notifyError: vi.fn() }));

import PageCatalogPage from "../PageCatalogPage";

const box = (label) => screen.getByRole("checkbox", { name: `Show ${label} in side nav` });

describe("PageCatalogPage", () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    get.mockResolvedValue({ data: { hiddenLabels: ["Audit Agent"], flagOn: true } });
    put.mockResolvedValue({ data: {} });
  });

  it("reflects hidden labels as unchecked and saves a toggle", async () => {
    render(<PageCatalogPage />);
    await waitFor(() => expect(box("Weather MCP")).not.toBeDisabled());
    expect(box("Audit Agent")).not.toBeChecked();
    expect(box("Weather MCP")).toBeChecked();

    fireEvent.click(box("Weather MCP"));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/api/user/nav-config", {
        hiddenLabels: ["Audit Agent", "Weather MCP"],
        activeConfigId: null,
      }),
    );
  });

  it("rolls the checkbox back when the save fails", async () => {
    put.mockRejectedValue(new Error("boom"));
    render(<PageCatalogPage />);
    await waitFor(() => expect(box("Weather MCP")).not.toBeDisabled());
    fireEvent.click(box("Weather MCP"));
    await waitFor(() => expect(box("Weather MCP")).toBeChecked());
  });

  it("disables checkboxes when sidebar customization is off", async () => {
    get.mockResolvedValue({ data: { hiddenLabels: [], flagOn: false } });
    render(<PageCatalogPage />);
    await screen.findByText(/Sidebar customization is off/);
    expect(box("Weather MCP")).toBeDisabled();
  });
});
