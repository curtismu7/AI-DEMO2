import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import DemoConfigPage from "../components/DemoConfigPage";

vi.mock("../styles/appShellPages.css", () => ({}), { virtual: true });
vi.mock("../components/DemoConfigPage.css", () => ({}), { virtual: true });
vi.mock("../config/navStructureCatalog", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    NAV_STRUCTURE_CATALOG: [
      { label: "Themes" },
      { label: "Monitoring", children: ["Audit Trail", "Activity Log"] },
      { label: "Authorize", children: ["Scope Audit"] },
    ],
    NAV_ITEM_CATALOG: ["Themes", "Monitoring", "Authorize"],
  };
});

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

  it("drags a child item from one group to another and saves it as childOrder", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Monitoring")).toBeInTheDocument());

    // Expand both groups (Monitoring and Authorize have children).
    const expandButtons = screen.getAllByLabelText("Expand");
    expect(expandButtons).toHaveLength(2);
    fireEvent.click(expandButtons[0]);
    fireEvent.click(expandButtons[1]);

    // Drag "Audit Trail" (Monitoring) onto "Scope Audit" (Authorize) — inserts before it.
    fireEvent.dragStart(screen.getByText("Audit Trail"));
    fireEvent.drop(screen.getByText("Scope Audit"));

    fireEvent.click(screen.getByRole("button", { name: "Save & refresh sidebar" }));

    await waitFor(() => {
      const put = global.fetch.mock.calls.find(
        (call) => call[1]?.method === "PUT" && String(call[0]).includes("/api/user/nav-config"),
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(put[1].body).childOrder).toEqual({
        Monitoring: ["Activity Log"],
        Authorize: ["Audit Trail", "Scope Audit"],
      });
    });
  });

  it("shows an error banner when the prefs fetch fails", async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("applies a config with empty flagSnapshot without calling PATCH", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Full mode")).toBeInTheDocument());

    const applyButtons = screen.getAllByRole("button", { name: "Apply" });
    fireEvent.click(applyButtons[0]);

    await waitFor(() => expect(screen.getByText(/Applied.*Full mode/)).toBeInTheDocument());

    const calls = global.fetch.mock.calls;
    const patchCalls = calls.filter((call) => call[1]?.method === "PATCH" && String(call[0]).includes("/api/admin/feature-flags"));
    expect(patchCalls).toHaveLength(0);

    const putCalls = calls.filter((call) => call[1]?.method === "PUT" && String(call[0]).includes("/api/user/nav-config"));
    expect(putCalls.length).toBeGreaterThan(0);
  });
});
