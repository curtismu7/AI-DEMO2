import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import fs from "node:fs";

import DemoConfigPage from "../components/DemoConfigPage";

vi.mock("../components/DemoConfigPage.css", () => ({}), { virtual: true });
vi.mock("../config/navStructureCatalog", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    NAV_STRUCTURE_CATALOG: [
      { label: "Skin Studio" },
      { label: "Monitoring", children: ["Audit Trail", "Activity Log"] },
      { label: "Authorize", children: ["Scope Audit"] },
    ],
    NAV_ITEM_CATALOG: ["Skin Studio", "Monitoring", "Authorize"],
  };
});

const PREFS_RESPONSE = { hiddenLabels: ["Skin Studio"], activeConfigId: null, flagOn: true };
const CONFIGS_RESPONSE = {
  configs: [
    { id: "full-mode", name: "Full mode", isBuiltin: true, hiddenLabels: [], flagSnapshot: {} },
    { id: "demo-mode", name: "Demo mode", isBuiltin: true, hiddenLabels: ["Skin Studio"], flagSnapshot: {} },
  ],
};

function mockFetch(overrides = {}) {
  global.fetch = vi.fn((url, opts) => {
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
  vi.clearAllMocks();
});

describe("DemoConfigPage", () => {
  it("renders the catalog as checkboxes, unchecking hidden items", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Skin Studio")).toBeInTheDocument());

    expect(screen.getByLabelText("Skin Studio")).not.toBeChecked();
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

  it("filters groups and pages from the search field", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Skin Studio")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("searchbox", { name: /search groups and pages/i }), {
      target: { value: "audit" },
    });

    expect(screen.getByText("Audit Trail")).toBeInTheDocument();
    expect(screen.queryByText("Skin Studio")).not.toBeInTheDocument();
  });

  it("collapses a visual section without changing its group selections", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Skin Studio")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /core navigation/i }));

    expect(screen.queryByText("Skin Studio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /core navigation/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows page links for groups and child items", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Monitoring")).toBeInTheDocument());
    screen.getAllByRole("button", { name: /^Expand / }).forEach((button) => fireEvent.click(button));

    expect(screen.getAllByRole("columnheader", { name: "Page" })).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: /^Open / })).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Open Skin Studio" })).toHaveAttribute("href", "/admin/skin-studio");
    expect(screen.getByRole("link", { name: "Open Monitoring" })).toHaveAttribute("href", "/audit");
    expect(screen.getByRole("link", { name: "Open Audit Trail" })).toHaveAttribute("href", "/audit");
    expect(screen.getByRole("link", { name: "Open Activity Log" })).toHaveAttribute(
      "href",
      "/monitoring/activity-log",
    );
    expect(screen.getByRole("link", { name: "Open Authorize" })).toHaveAttribute("href", "/scope-audit");
    expect(screen.getByRole("link", { name: "Open Scope Audit" })).toHaveAttribute("href", "/scope-audit");
  });

  it("keeps demo config surfaces on theme tokens, with no hard-coded colour or sub-10px type", () => {
    const css = fs.readFileSync("src/components/DemoConfigPage.css", "utf8");
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/\brgba?\(/);
    expect(noComments).not.toMatch(/font-size:\s*\d/);
    expect(css).toMatch(/\.dc-page \.dc-open-link\s*\{[^}]*color:\s*var\(--th-bg-emphasis\)/);
    expect(css).toMatch(/\.dc-group-row\s*\{[^}]*background:\s*var\(--th-bg-card\)/);
  });

  it("opens with a role=note banner that says the settings are live, and one primary button", async () => {
    mockFetch();
    const { container } = render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Skin Studio")).toBeInTheDocument());

    const banner = screen.getByTestId("dc-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner).toHaveTextContent(/nothing on this page is simulated/i);
    expect(container.querySelector(".dc-page").firstElementChild).toContainElement(banner);
    expect(container.querySelectorAll(".pu-btn--primary")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save & refresh sidebar" })).toHaveClass("pu-btn--primary");
  });

  it("shows the flag as a chip with a word, and each config's group count as a key-value row", async () => {
    mockFetch();
    const { container } = render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Full mode")).toBeInTheDocument());

    expect(container.querySelector(".pu-chip")).toHaveTextContent("On");
    const demo = screen.getByTestId("dc-config-demo-mode");
    expect(demo).toHaveTextContent("Groups shown");
    // 3 catalog groups, one hidden by the config.
    expect(demo.querySelector(".pu-kv dd")).toHaveTextContent("2");
  });

  it("counts only catalog groups a config shows, never a negative number", async () => {
    mockFetch({
      configs: {
        configs: [
          { id: "stale", name: "Stale", hiddenLabels: ["Gone 1", "Gone 2", "Gone 3", "Gone 4", "Skin Studio"], flagSnapshot: {} },
        ],
      },
    });
    render(<DemoConfigPage />);
    const card = await screen.findByTestId("dc-config-stale");
    expect(card.querySelector(".pu-kv dd")).toHaveTextContent("2");
  });

  it("marks the applied config with an Active chip", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Demo mode")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Apply Demo mode" }));
    const card = screen.getByTestId("dc-config-demo-mode");
    await waitFor(() => expect(card).toHaveTextContent("Active"));
    expect(card).toHaveClass("pu-card--ok");
  });

  it("keeps focus on the control that was activated while a save is in flight", async () => {
    let release;
    global.fetch = vi.fn((url, opts) => {
      const method = (opts && opts.method) || "GET";
      if (String(url).includes("/api/user/nav-config") && method === "PUT") {
        return new Promise((resolve) => {
          release = () => resolve({ ok: true, json: async () => ({}) });
        });
      }
      if (String(url).includes("/api/nav-configs")) return Promise.resolve({ ok: true, json: async () => CONFIGS_RESPONSE });
      return Promise.resolve({ ok: true, json: async () => PREFS_RESPONSE });
    });
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Skin Studio")).toBeInTheDocument());

    const save = screen.getByRole("button", { name: "Save & refresh sidebar" });
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(save).toHaveAttribute("aria-disabled", "true"));
    expect(save).not.toBeDisabled();
    expect(save).toHaveFocus();

    // A second click while busy does not send a second request.
    fireEvent.click(save);
    const puts = () => global.fetch.mock.calls.filter((c) => c[1]?.method === "PUT");
    expect(puts()).toHaveLength(1);

    release();
    await waitFor(() => expect(save).not.toHaveAttribute("aria-disabled"));
    expect(save).toHaveFocus();
    expect(await screen.findByRole("status")).toHaveTextContent(/Saved/);
  });

  it("hands focus to Save when Reset order is pressed and unmounts (focus must not fall to the body)", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Monitoring")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Move Skin Studio down" }));
    const reset = await screen.findByRole("button", { name: "Reset order" });
    reset.focus();
    expect(reset).toHaveFocus();
    fireEvent.click(reset);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reset order" })).toBeNull());
    expect(screen.getByRole("button", { name: /Save & refresh sidebar/ })).toHaveFocus();
  });

  it("moves a group with its up/down buttons, keeps focus, and announces the move", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Monitoring")).toBeInTheDocument());

    const down = screen.getByRole("button", { name: "Move Skin Studio down" });
    down.focus();
    fireEvent.click(down);
    expect(down).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Moved Skin Studio down: position 2 of 3");
    // The first group can no longer move up, and says so without losing focus.
    expect(screen.getByRole("button", { name: "Move Monitoring up" })).toHaveAttribute("aria-disabled", "true");
  });

  it("reorders a page inside its group from the keyboard buttons and saves it as childOrder", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Monitoring")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Expand Monitoring" }));
    expect(screen.getByRole("button", { name: "Collapse Monitoring" })).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByRole("button", { name: "Move Audit Trail up in Monitoring" })).toHaveAttribute("aria-disabled", "true");
    const down = screen.getByRole("button", { name: "Move Audit Trail down in Monitoring" });
    down.focus();
    fireEvent.click(down);
    expect(down).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Moved Audit Trail down in Monitoring: position 2 of 2");

    fireEvent.click(screen.getByRole("button", { name: "Save & refresh sidebar" }));
    await waitFor(() => {
      const put = global.fetch.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      expect(JSON.parse(put[1].body).childOrder).toEqual({ Monitoring: ["Activity Log", "Audit Trail"] });
    });
  });

  it("does not reorder pages while a search filters the list", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Monitoring")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("searchbox", { name: /search groups and pages/i }), { target: { value: "audit" } });

    const down = screen.getByRole("button", { name: "Move Audit Trail down in Monitoring" });
    expect(down).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(down);
    expect(screen.queryByRole("status")).not.toHaveTextContent(/Moved Audit Trail/);
  });

  it("saves a new config from the name field with Enter and keeps focus in the field", async () => {
    mockFetch();
    global.fetch = vi.fn((url, opts) => {
      const method = (opts && opts.method) || "GET";
      if (String(url).includes("/api/admin/feature-flags")) return Promise.resolve({ ok: true, json: async () => ({ flags: [] }) });
      if (String(url).includes("/api/nav-configs") && method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ config: { id: "n1", name: "Exec", hiddenLabels: [], flagSnapshot: {} } }) });
      }
      if (String(url).includes("/api/nav-configs")) return Promise.resolve({ ok: true, json: async () => CONFIGS_RESPONSE });
      return Promise.resolve({ ok: true, json: async () => PREFS_RESPONSE });
    });
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Full mode")).toBeInTheDocument());

    const input = screen.getByLabelText("Config name");
    const submit = screen.getByRole("button", { name: "Save as new config" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(input, { target: { value: "Exec" } });
    expect(submit).not.toHaveAttribute("aria-disabled");
    fireEvent.submit(input.closest("form"));

    await screen.findByTestId("dc-config-n1");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("");
  });

  function mockOneConfig() {
    global.fetch = vi.fn((url, opts) => {
      const method = (opts && opts.method) || "GET";
      if (method === "DELETE") return Promise.resolve({ ok: true, json: async () => ({}) });
      if (String(url).includes("/api/nav-configs")) {
        return Promise.resolve({ ok: true, json: async () => ({ configs: [{ id: "mine", name: "Mine", hiddenLabels: [], flagSnapshot: {} }] }) });
      }
      return Promise.resolve({ ok: true, json: async () => PREFS_RESPONSE });
    });
  }
  const deletes = () => global.fetch.mock.calls.filter((c) => c[1]?.method === "DELETE");

  it("asks for confirmation before deleting a saved config, then moves focus to the saved-configs list", async () => {
    mockOneConfig();
    render(<DemoConfigPage />);
    await screen.findByText("Mine");

    const del = screen.getByRole("button", { name: "Delete Mine" });
    del.focus();
    fireEvent.click(del);
    // First click only asks: nothing is deleted, the row now offers Confirm / Cancel, focus lands on the safe one.
    expect(deletes()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Delete Mine" })).not.toBeInTheDocument();
    const cancel = screen.getByRole("button", { name: "Cancel delete Mine" });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent(/shared library/i);

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Mine" }));
    await waitFor(() => expect(screen.queryByText("Mine")).not.toBeInTheDocument());
    expect(deletes()).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Saved configs" })).toHaveFocus();
  });

  it("cancelling a delete (button or Escape) keeps the config and returns focus to its Delete button", async () => {
    mockOneConfig();
    render(<DemoConfigPage />);
    await screen.findByText("Mine");

    fireEvent.click(screen.getByRole("button", { name: "Delete Mine" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel delete Mine" }));
    const del = screen.getByRole("button", { name: "Delete Mine" });
    await waitFor(() => expect(del).toHaveFocus());
    expect(deletes()).toHaveLength(0);

    fireEvent.click(del);
    const cancel = await screen.findByRole("button", { name: "Cancel delete Mine" });
    fireEvent.keyDown(cancel, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete Mine" })).toHaveFocus());
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(deletes()).toHaveLength(0);
  });

  it("says in the banner that saved configs are a shared library", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    expect(screen.getByTestId("dc-banner")).toHaveTextContent(/saved configs are shared/i);
    expect(screen.getByTestId("dc-banner")).toHaveTextContent(/for your account only/i);
  });

  it("clears the screen-reader move announcement when an error is dismissed", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Monitoring")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Move Skin Studio down" }));
    expect(screen.getByRole("status")).toHaveTextContent("Moved Skin Studio down");

    // Force an error (save fails), then dismiss it.
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Save & refresh sidebar" }));
    const dismiss = await screen.findByRole("button", { name: "Dismiss" });
    fireEvent.click(dismiss);
    expect(document.querySelector(".dc-sr-only")).toHaveTextContent("");
    expect(document.querySelector(".dc-messages")).toHaveFocus();
  });

  it("group visibility checkbox focus ring beats the global checkbox sweep", () => {
    const css = fs.readFileSync("src/components/DemoConfigPage.css", "utf8");
    const rule = css.match(/([^{}]*\.dc-group-toggle input\[type="checkbox"\]:focus-visible[^{}]*)\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule[2]).toMatch(/outline:\s*3px solid/);
    expect(rule[2]).toMatch(/box-shadow:\s*none/);
  });

  it("dismisses an error and returns focus to the message area", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    render(<DemoConfigPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss" });
    expect(screen.getByRole("alert")).toHaveTextContent("Error");
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.querySelector(".dc-messages")).toHaveFocus();
  });

  it("drags a child item from one group to another and saves it as childOrder", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Monitoring")).toBeInTheDocument());

    // Expand both groups (Monitoring and Authorize have children).
    const expandButtons = screen.getAllByRole("button", { name: /^Expand / });
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
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("applies a config with empty flagSnapshot without calling PATCH", async () => {
    mockFetch();
    render(<DemoConfigPage />);
    await waitFor(() => expect(screen.getByText("Full mode")).toBeInTheDocument());

    const applyButtons = screen.getAllByRole("button", { name: /^Apply / });
    fireEvent.click(applyButtons[0]);

    await waitFor(() => expect(screen.getByText(/Applied.*Full mode/)).toBeInTheDocument());

    const calls = global.fetch.mock.calls;
    const patchCalls = calls.filter((call) => call[1]?.method === "PATCH" && String(call[0]).includes("/api/admin/feature-flags"));
    expect(patchCalls).toHaveLength(0);

    const putCalls = calls.filter((call) => call[1]?.method === "PUT" && String(call[0]).includes("/api/user/nav-config"));
    expect(putCalls.length).toBeGreaterThan(0);
  });
});
