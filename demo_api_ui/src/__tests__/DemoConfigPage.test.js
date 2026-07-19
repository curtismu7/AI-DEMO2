import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import DemoConfigPage from "../components/DemoConfigPage";

vi.mock("../styles/appShellPages.css", () => ({}), { virtual: true });
vi.mock("../components/DemoConfigPage.css", () => ({}), { virtual: true });
vi.mock("../config/navItemsCatalog", () => ({
  NAV_ITEM_CATALOG: ["Themes", "Monitoring", "Authorize"],
}));

const PREFS_RESPONSE = { hiddenLabels: ["Themes"], activeConfigId: null, flagOn: true };
const CONFIGS_RESPONSE = {
  configs: [
    { id: "full-mode", name: "Full mode", isBuiltin: true, hiddenLabels: [], flagSnapshot: {} },
    { id: "demo-mode", name: "Demo mode", isBuiltin: true, hiddenLabels: ["Themes"], flagSnapshot: {} },
  ],
};

function mockFetch(overrides = {}) {
  global.fetch = jest.fn((url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (String(url).includes("/api/user/nav-config") && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => overrides.prefs || PREFS_RESPONSE });
    }
    if (String(url).includes("/api/nav-configs") && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => overrides.configs || CONFIGS_RESPONSE });
    }
    if (String(url).includes("/api/user/nav-config") && method === "PUT") {
      return Promise.resolve({ ok: true, json: async () => ({ hiddenLabels: [], activeConfigId: null, flagOn: true }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("DemoConfigPage", () => {
  it("renders the catalog as checkboxes, unchecking hidden items", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Themes")).toBeInTheDocument());

    expect(screen.getByLabelText("Themes")).not.toBeChecked();
    expect(screen.getByLabelText("Monitoring")).toBeChecked();
  });

  it("lists saved configs from /api/nav-configs", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Full mode")).toBeInTheDocument());
    expect(screen.getByText("Demo mode")).toBeInTheDocument();
  });

  it("toggling a checkbox updates the visible count", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText(/of 3 visible/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Monitoring"));
    expect(await screen.findByText(/1 of 3 visible/)).toBeInTheDocument();
  });

  it("shows an error banner when the prefs fetch fails", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
