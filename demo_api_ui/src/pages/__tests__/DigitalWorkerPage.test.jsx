/* eslint-disable testing-library/no-node-access, testing-library/no-container -- React Flow nodes have no role; the "draggable" class is what shows they move */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DigitalWorkerPage from "../DigitalWorkerPage";
import { INITIAL_EDGES } from "../digitalWorkerDiagram";
import { PAGE_GUIDES } from "../../config/pageGuides";
import { lessonCatalog } from "../../learning/lessonCatalog";

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../utils/signInService", () => ({ openSignIn: vi.fn() }));
// Prop probe: the page's contract with the studio is the props it passes (scenario, vertical, consentGate),
// none of which show up in the real studio's DOM. "probe run" calls consentGate the way the Run button does.
vi.mock("../PersonalAgentStudioPage", async () => {
  const { createElement, useState } = await import("react");
  return {
    default: ({ scenario, vertical, runNonce, consentGate }) => {
      const [gate, setGate] = useState("");
      return createElement("div", {
        "data-testid": "studio",
        "data-scenario": scenario ? scenario.id : "",
        "data-vertical": vertical || "",
        "data-nonce": runNonce,
        "data-has-gate": String(typeof consentGate === "function"),
        "data-gate-result": gate,
      }, consentGate ? createElement("button", { type: "button", onClick: async () => setGate(String(await consentGate(scenario))) }, "probe run") : null);
    },
  };
});
// The consent phone is a floating modal; render its body inline so the test can reach the Approve/Deny taps.
vi.mock("../../components/DraggableModal", () => ({ default: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null) }));

import apiClient from "../../services/apiClient";
import { openSignIn } from "../../utils/signInService";

const UC38 = {
  id: "UC38", useCaseId: "personal-agent-concierge", title: "Workload Agent: MFA-gated protected action",
  primaryTool: "create_transfer", runPrompt: "transfer $600 from checking to savings",
};

beforeEach(() => {
  apiClient.get.mockImplementation((url) => {
    if (url === "/api/verticals/list") return Promise.resolve({ data: [{ id: "banking", displayName: "Banking" }, { id: "airlines", displayName: "Airlines" }] });
    if (url.startsWith("/api/use-cases/UC38")) return Promise.resolve({ data: { useCase: UC38 } });
    if (url.startsWith("/api/autonomous-runs/flag")) return Promise.resolve({ data: { enabled: false } });
    return Promise.resolve({ data: {} });
  });
});

function renderPage(route = "/digital-worker") {
  return render(<MemoryRouter initialEntries={[route]}><DigitalWorkerPage /></MemoryRouter>);
}

describe("DigitalWorkerPage diagram rule", () => {
  it("nodes are draggable and editing tools stay", () => {
    localStorage.clear();
    const { container } = renderPage();
    const nodes = container.querySelectorAll(".react-flow__node");
    expect(nodes.length).toBeGreaterThan(0);
    nodes.forEach((n) => expect(n.classList.contains("draggable")).toBe(true));
    expect(screen.getByText("+ Add box")).toBeTruthy();
    expect(screen.getByText("Undo")).toBeTruthy();
  });

  it("Simulate walks the arrows at the chosen speed and Reset clears the walkthrough", () => {
    localStorage.clear();
    renderPage();
    const bar = screen.getByTestId("dw-steps");
    expect(bar.querySelector(".dc-steptime-select")).toBeTruthy();
    fireEvent.click(within(bar).getByText("Simulate"));
    expect(within(bar).getByText(`Step 1 of ${INITIAL_EDGES.length}`)).toBeTruthy();
    fireEvent.click(within(bar).getByText("Reset"));
    expect(within(bar).getByText("Simulate")).toBeTruthy();
  });

  // Regression: the step bar sat in the canvas under the absolutely positioned .dw-bar, so a real click on
  // Simulate hit the toolbar instead (jsdom has no layout, so the click test above could not see it).
  it("step bar lives inside the floating toolbar, not underneath it", () => {
    localStorage.clear();
    renderPage();
    expect(screen.getByTestId("dw-steps").parentElement.classList.contains("dw-bar")).toBe(true);
  });
});

describe("DigitalWorkerPage Ping UI Standard", () => {
  it("opens with the honest banner as the first element inside the page root, before the title band", async () => {
    const { container } = renderPage();
    const root = container.querySelector(".pu-page.dw-page");
    expect(root).toBeTruthy();
    const banner = screen.getByTestId("dw-banner");
    expect(banner.getAttribute("role")).toBe("note");
    expect(root.firstElementChild.contains(banner)).toBe(true);
    // what is simulated: the phone and the drawing; no source is named, so the text cannot disagree with the mode in use
    expect(banner).toHaveTextContent(/mock/i);
    expect(banner).toHaveTextContent(/drawing/i);
    expect(banner).not.toHaveTextContent(/PingOne|gateway/i);
    expect(banner.compareDocumentPosition(screen.getByRole("heading", { level: 1, name: "Digital Worker" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await screen.findByTestId("studio");
  });

  it("labels the diagram as a drawing with a chip that carries a word, and the toolbar buttons are secondaries", async () => {
    renderPage();
    const diagram = screen.getByRole("region", { name: "How it works" });
    expect(within(diagram).getByText("Drawing")).toBeTruthy();
    const bar = within(diagram).getByText("+ Add box").closest(".dw-bar");
    bar.querySelectorAll(":scope > button").forEach((b) => {
      expect(b.classList.contains("pu-btn")).toBe(true);
      expect(b.classList.contains("pu-btn--primary")).toBe(false);
    });
    await screen.findByTestId("studio");
  });

  it("Undo keeps keyboard focus when there is nothing to undo (aria-disabled, not disabled)", async () => {
    localStorage.clear();
    renderPage();
    const undo = screen.getByText("Undo");
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    expect(undo.disabled).toBe(false);
    undo.focus();
    fireEvent.click(undo);
    expect(document.activeElement).toBe(undo);
    await screen.findByTestId("studio");
  });

  it("signed out: the one primary on the Attended tab is Sign in, with a visible reason", async () => {
    const wall = Object.assign(new Error("Unauthorized"), { response: { status: 401 } });
    apiClient.get.mockImplementation((url) => (url.startsWith("/api/autonomous-runs") ? Promise.resolve({ data: { enabled: false } }) : Promise.reject(wall)));
    renderPage();
    await screen.findByText("Sign in to run the governed worker.");
    const attended = document.getElementById("dw-pane-attended");
    expect(within(attended).getByText("Sign-in needed")).toBeTruthy();
    expect([...attended.querySelectorAll(".pu-btn--primary")].map((b) => b.textContent)).toEqual(["Sign in"]);
    expect(openSignIn).not.toHaveBeenCalled(); // nothing navigates until the visitor presses it
  });

  it("a failed catalog load is a chip with a word, not colour alone", async () => {
    apiClient.get.mockImplementation((url) => (url.startsWith("/api/use-cases/UC38") ? Promise.reject(new Error("down")) : Promise.resolve({ data: {} })));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Failed")).toBeTruthy();
  });
});

describe("DigitalWorkerPage learning surfaces", () => {
  it("page guide lists the digital-worker-live lesson and the catalog has it", () => {
    expect(PAGE_GUIDES["/digital-worker"].lessons).toContain("digital-worker-live");
    expect(lessonCatalog.some((lesson) => lesson.id === "digital-worker-live")).toBe(true);
  });
});

describe("DigitalWorkerPage run sections", () => {
  it("renders the lede, the tabs, the studio, and the unattended panel", async () => {
    renderPage();
    expect(screen.getByText(/An assistant answers questions\. A worker takes action — it holds delegated identity, spends it across tools, and every action is governed\./)).toBeTruthy();
    expect(await screen.findByText("Transfer with step-up MFA and human approval")).toBeTruthy();
    // The studio's own "Run <action>" is the one way to start a run: the page adds no second button.
    expect(await screen.findByTestId("studio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run worker task" })).toBeNull();
    // The unattended panel lives on its own tab; it self-fetches its flag, then shows its unarmed state.
    fireEvent.click(screen.getByRole("tab", { name: /Unattended/ }));
    expect(await screen.findByRole("switch", { name: /arm the worker/i })).toBeTruthy();
  });

  it("says it is loading until the governed run arrives", async () => {
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the governed run…");
    await screen.findByTestId("studio");
    expect(screen.queryByText("Loading the governed run…")).toBeNull();
  });

  it("puts the agent first and the diagram last", async () => {
    renderPage();
    await screen.findByTestId("studio"); // let the page's fetches settle
    const agent = screen.getByRole("region", { name: "Digital worker agent" });
    const diagram = screen.getByRole("region", { name: "How it works" });
    // DOCUMENT_POSITION_FOLLOWING: the diagram comes after the agent card.
    expect(agent.compareDocumentPosition(diagram) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(diagram).getByRole("heading", { name: "How it works" })).toBeTruthy();
  });

  it("opens on Attended and switches modes without unmounting either", async () => {
    renderPage();
    const attended = screen.getByRole("tab", { name: /Attended/ });
    const unattended = screen.getByRole("tab", { name: /Unattended/ });
    expect(attended.getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("dw-pane-unattended").hidden).toBe(true);

    fireEvent.click(unattended);
    expect(unattended.getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("dw-pane-attended").hidden).toBe(true);
    expect(document.getElementById("dw-pane-unattended").hidden).toBe(false);

    // Both panes stay in the DOM, so the studio's run and the panel's arm state survive a switch.
    await screen.findByTestId("studio");
    fireEvent.click(attended);
    expect(screen.getByTestId("studio")).toBeTruthy();
  });

  it("mounts UC38 from the two catalog fetches and never auto-runs it", async () => {
    renderPage();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/verticals/list"));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/use-cases/UC38?vertical=banking"));
    const studio = await screen.findByTestId("studio");
    expect(studio.dataset.scenario).toBe("UC38");
    expect(studio.dataset.vertical).toBe("banking");
    // No runNonce is passed, so mounting cannot fire the workload: only the studio's own button does.
    expect(studio.dataset.nonce).toBeUndefined();
  });

  it("honours a ?vertical deep link", async () => {
    renderPage("/digital-worker?vertical=airlines");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/use-cases/UC38?vertical=airlines"));
    expect((await screen.findByTestId("studio")).dataset.vertical).toBe("airlines");
  });

  it("names the failed catalog load instead of leaving a spinner", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === "/api/verticals/list") return Promise.resolve({ data: [{ id: "banking", displayName: "Banking" }] });
      if (url.startsWith("/api/use-cases/UC38")) return Promise.reject(new Error("catalog down"));
      if (url.startsWith("/api/autonomous-runs/flag")) return Promise.resolve({ data: { enabled: false } });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("The governed run could not be loaded for this vertical.");
    expect(screen.queryByTestId("studio")).toBeNull();
    expect(screen.queryByText("Loading the governed run…")).toBeNull();
  });

  it("the jump link scrolls to the diagram without navigating", async () => {
    // Set on HTMLElement.prototype: the suite's setup may already define it there, shadowing Element's.
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      renderPage();
      await screen.findByTestId("studio");
      const notPrevented = fireEvent.click(screen.getByRole("link", { name: /Jump to the diagram/ }));
      expect(notPrevented).toBe(false); // preventDefault: no hash push onto the router history
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it("a 401 from the wall shows a sign-in invitation that returns to this page, not an error", async () => {
    const wall = Object.assign(new Error("Unauthorized"), { response: { status: 401, data: { error: "hosted_access_required" } } });
    apiClient.get.mockImplementation((url) => (url.startsWith("/api/autonomous-runs") ? Promise.resolve({ data: { enabled: false } }) : Promise.reject(wall)));
    renderPage();

    expect(await screen.findByText("Sign in to run the governed worker.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull(); // the red error is for real failures only
    expect(screen.queryByText("Loading the governed run…")).toBeNull();
    expect(screen.queryByTestId("studio")).toBeNull();

    fireEvent.click(within(document.getElementById("dw-pane-attended")).getByRole("button", { name: "Sign in" }));
    expect(openSignIn).toHaveBeenCalledWith({ returnTo: "/digital-worker" });
  });
});

describe("DigitalWorkerPage consent phone", () => {
  const PARKED = {
    runId: "r1", job: "balance-sweep", status: "parked", agent: "Super Banking Balance Sweep Agent",
    tokenEvents: [], findings: [], proposal: { fromAccountId: "chk-1", amount: 1000, fromName: "Checking" },
    pending: { authReqId: "sim-1", initiatedAt: Date.now(), expiresIn: 300, loginHint: "u1" },
  };
  const pending = (body) => ({ state: "pending", loginHint: "tarun", type: "transfer", trace: [], ...body });

  beforeEach(() => {
    apiClient.post.mockReset();
    apiClient.post.mockImplementation((url, body) => {
      if (url === "/api/consent-mock-phone/start") return Promise.resolve({ data: pending(body) });
      if (url === "/api/consent-mock-phone/decision") return Promise.resolve({ data: pending({ ...UC38_PENDING, state: body.decision === "approve" ? "approved" : "denied" }) });
      if (url === "/api/autonomous-runs/run") return Promise.resolve({ data: { run: PARKED } });
      return Promise.resolve({ data: { run: { ...PARKED, status: "completed" } } });
    });
  });
  const UC38_PENDING = { amount: 600, description: "transfer $600 from checking to savings" };

  it("gives the studio a gate that asks on the phone, with the amount read from the run prompt", async () => {
    renderPage();
    expect((await screen.findByTestId("studio")).dataset.hasGate).toBe("true");
    fireEvent.click(screen.getByText("probe run"));
    await screen.findByTestId("consent-mock-phone");
    expect(apiClient.post).toHaveBeenCalledWith("/api/consent-mock-phone/start", { amount: 600, type: "transfer", description: "transfer $600 from checking to savings" });

    fireEvent.click(screen.getByText("Approve on mock phone"));
    await waitFor(() => expect(screen.getByTestId("studio").dataset.gateResult).toBe("true"));
  });

  it("blocks the run when the phone denies it", async () => {
    renderPage();
    await screen.findByTestId("studio");
    fireEvent.click(screen.getByText("probe run"));
    await screen.findByTestId("consent-mock-phone");
    fireEvent.click(screen.getByText("Deny on mock phone"));
    await waitFor(() => expect(screen.getByTestId("studio").dataset.gateResult).toBe("false"));
  });

  it("a signed-out phone shows a sign-in message whose button is a secondary, so the run's own primary stays the one", async () => {
    apiClient.post.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("Unauthorized"), { response: { status: 401 } })));
    renderPage();
    await screen.findByTestId("studio");
    fireEvent.click(screen.getByText("probe run"));
    const host = await waitFor(() => {
      const el = document.querySelector(".dw-consent");
      expect(el).toBeTruthy();
      return el;
    });
    expect(within(host).getByText("Sign-in needed")).toBeTruthy();
    expect(within(host).getByRole("button", { name: "Sign in" }).classList.contains("pu-btn--primary")).toBe(false);
    expect(host.querySelectorAll(".pu-btn--primary")).toHaveLength(0);
    // the phone card the visitor was in is gone: focus lands on the named sign-in group, not the body
    const group = within(host).getByRole("group", { name: "Sign-in needed" });
    await waitFor(() => expect(document.activeElement).toBe(group));
  });

  it("runs without a phone when the run prompt names no amount (nothing to approve)", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url.startsWith("/api/use-cases/UC38")) return Promise.resolve({ data: { useCase: { ...UC38, runPrompt: "check my balance" } } });
      if (url.startsWith("/api/autonomous-runs/flag")) return Promise.resolve({ data: { enabled: false } });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    await screen.findByTestId("studio");
    fireEvent.click(screen.getByText("probe run"));
    await waitFor(() => expect(screen.getByTestId("studio").dataset.gateResult).toBe("true"));
    expect(apiClient.post).not.toHaveBeenCalledWith("/api/consent-mock-phone/start", expect.anything());
  });

  it("approves a parked unattended run on the same phone", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url.startsWith("/api/use-cases/UC38")) return Promise.resolve({ data: { useCase: UC38 } });
      if (url.startsWith("/api/autonomous-runs/flag")) return Promise.resolve({ data: { enabled: true } });
      if (url.startsWith("/api/autonomous-runs")) return Promise.resolve({ data: { runs: [] } });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /Unattended/ }));
    fireEvent.click(await screen.findByRole("button", { name: /fire without a human turn/i }));
    fireEvent.click(await screen.findByRole("button", { name: /ask for approval on the phone/i }));

    await screen.findByTestId("consent-mock-phone");
    expect(apiClient.post).toHaveBeenCalledWith("/api/consent-mock-phone/start", expect.objectContaining({ amount: 1000, type: "transfer" }));
    fireEvent.click(screen.getByText("Approve on mock phone"));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/autonomous-runs/r1/approve"));
  });
});
