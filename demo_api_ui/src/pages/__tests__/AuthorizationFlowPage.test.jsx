import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import AuthorizationFlowPage from "../AuthorizationFlowPage";
import { DEFAULT_VERTICAL, SLOTS, VERTICAL_OPTIONS, lanesFor, momentsFor, profileFor } from "../authorizationFlowData";
import { detailFor } from "../authorizationFlowDetails";

const LANES = lanesFor(DEFAULT_VERTICAL);
const MOMENTS = momentsFor(DEFAULT_VERTICAL);

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlow: ({ nodes, edges }) => React.createElement("div", { "data-testid": "flow", "data-nodes": nodes.length, "data-edges": edges.length }),
    ReactFlowProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: { Left: "left", Right: "right" },
    ConnectionMode: { Loose: "loose" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    useNodesState: (init) => [init, () => {}, () => {}],
    useReactFlow: () => ({ fitView: () => {} }),
  };
});

// The page keeps the chosen vertical in the URL; start every test on a clean one.
beforeEach(() => window.history.replaceState(null, "", "/"));

describe("authorization flow data", () => {
  it("has six moments per vertical, each arrow joining two real lanes within the slot count", () => {
    const ids = new Set(LANES.map((l) => l.id));
    for (const v of VERTICAL_OPTIONS) {
      const moments = momentsFor(v.id);
      expect(moments, v.id).toHaveLength(6);
      for (const mo of moments) {
        expect(mo.steps.length, `${v.id} ${mo.id}`).toBeLessThanOrEqual(SLOTS);
        for (const st of mo.steps) {
          expect(ids.has(st.from), `${v.id} ${mo.id} ${st.from}`).toBe(true);
          expect(ids.has(st.to), `${v.id} ${mo.id} ${st.to}`).toBe(true);
        }
      }
    }
  });

  it("uses PingOne, not AIC, and dollars, not pounds, in every vertical", () => {
    for (const v of VERTICAL_OPTIONS) {
      const text = JSON.stringify([lanesFor(v.id), momentsFor(v.id)]);
      expect(text).toContain("PingOne");
      expect(text).not.toMatch(/\bAIC\b/);
      expect(text).not.toContain("\u00a3");
      expect(text).toContain("$50");
    }
  });

  it("never talks about banking outside the banking vertical", () => {
    for (const v of VERTICAL_OPTIONS.filter((x) => x.id !== "banking")) {
      const text = JSON.stringify([lanesFor(v.id), momentsFor(v.id)]);
      expect(text, v.id).not.toMatch(/\b(bank|Bank|balance|ledger|Steven|Blake|transfer)\b/);
    }
  });

  it("names the vertical's own business and tool", () => {
    const air = JSON.stringify(momentsFor("airlines"));
    expect(air).toContain("pay_airline_fee");
    expect(air).toContain("the airline");
    expect(JSON.stringify(momentsFor("healthcare"))).toContain("CareConnect");
    expect(lanesFor("healthcare").find((l) => l.id === "bc").label).toBe("Billing System");
  });

  it("refuses the $60 payment before any device push, in every vertical", () => {
    for (const v of VERTICAL_OPTIONS) {
      const ms = momentsFor(v.id);
      const pay60 = ms.find((x) => x.id === "pay-60");
      expect(pay60.steps.some((st) => st.block), v.id).toBe(true);
      expect(pay60.steps.some((st) => st.to === "ud"), v.id).toBe(false);
      expect(ms.find((x) => x.id === "pay-25").steps.some((st) => st.to === "ud"), v.id).toBe(true);
    }
  });
});

describe("AuthorizationFlowPage", () => {
  it("shows six moments, starts with no arrows, and says it is scripted", () => {
    render(<AuthorizationFlowPage />);
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    expect(screen.getByTestId("flow").dataset.nodes).toBe(String(LANES.length));
    expect(screen.getByTestId("flow").dataset.edges).toBe("0");
    expect(screen.getByTestId("af-banner").getAttribute("role")).toBe("note");
    expect(screen.getByTestId("af-banner").textContent).toMatch(/scripted walkthrough/);
    expect(screen.getByTestId("af-banner").textContent).toMatch(/no check runs/);
  });

  it("reveals one arrow per step and fills the conversation and outcome as it walks", () => {
    render(<AuthorizationFlowPage />);
    const bar = screen.getByTestId("af-step-bar");
    fireEvent.click(within(bar).getByText("Simulate"));
    expect(screen.getByTestId("flow").dataset.edges).toBe("1");
    expect(document.querySelector(".af-bubble--user").textContent).toBe("What’s my balance?");
    const total = MOMENTS[0].steps.length;
    fireEvent.click(within(bar).getByText("Pause"));
    for (let i = 1; i < total; i += 1) fireEvent.click(within(bar).getByText(/Next/));
    expect(screen.getByTestId("flow").dataset.edges).toBe(String(total));
    expect(screen.getByRole("status").textContent).toMatch(/Refused at the edge/);
  });

  it("switching moment clears the walkthrough", () => {
    render(<AuthorizationFlowPage />);
    fireEvent.click(within(screen.getByTestId("af-step-bar")).getByText("Simulate"));
    fireEvent.click(screen.getByRole("tab", { name: /Pay \$60/ }));
    expect(screen.getByTestId("flow").dataset.edges).toBe("0");
    expect(screen.getByText(/stops confirmation before the CIBA phone push/)).toBeTruthy();
  });
});

describe("AuthorizationFlowPage theme", () => {
  it("toggles the visualiser between dark and light", () => {
    document.documentElement.removeAttribute("data-theme");
    const { container } = render(<AuthorizationFlowPage />);
    const canvas = () => container.querySelector(".af-canvas");
    expect(canvas().dataset.afTheme).toBe("light");
    const toggle = screen.getByRole("button", { name: "Dark diagram" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(canvas().dataset.afTheme).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark diagram" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Dark diagram" }));
    expect(canvas().dataset.afTheme).toBe("light");
  });

  it("starts on the app theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const { container } = render(<AuthorizationFlowPage />);
    expect(container.querySelector(".af-canvas").dataset.afTheme).toBe("dark");
    document.documentElement.removeAttribute("data-theme");
  });
});


describe("AuthorizationFlowPage vertical selector", () => {
  it("lists every vertical and switches the story, the chips and the system-of-record lane", () => {
    render(<AuthorizationFlowPage />);
    const select = screen.getByLabelText("Vertical");
    expect(select.querySelectorAll("option")).toHaveLength(VERTICAL_OPTIONS.length);
    expect(screen.getByRole("tab", { name: /Read balance/ })).toBeTruthy();
    fireEvent.change(select, { target: { value: "airlines" } });
    expect(screen.getByRole("tab", { name: /Read reservations/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Read balance/ })).toBeNull();
    expect(screen.getByText(/the airline decides/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Pay \$25/ }));
    fireEvent.click(within(screen.getByTestId("af-step-bar")).getByText("Simulate"));
    expect(screen.getByText("Pay a $25 change fee")).toBeTruthy();
  });

  it("clears the walkthrough when the vertical changes", () => {
    render(<AuthorizationFlowPage />);
    fireEvent.click(within(screen.getByTestId("af-step-bar")).getByText("Simulate"));
    expect(screen.getByTestId("flow").dataset.edges).toBe("1");
    fireEvent.change(screen.getByLabelText("Vertical"), { target: { value: "healthcare" } });
    expect(screen.getByTestId("flow").dataset.edges).toBe("0");
  });
});


describe("step detail", () => {
  it("has a detail record for every step of every moment in every vertical", () => {
    for (const v of VERTICAL_OPTIONS) {
      for (const mo of momentsFor(v.id)) {
        for (const st of mo.steps) {
          const d = detailFor(st.key, profileFor(v.id), mo.amount || 25, mo.pay);
          expect(d, `${v.id} ${mo.id} ${st.key}`).toBeTruthy();
          expect(d.what && d.why && d.checks.length, `${v.id} ${st.key}`).toBeTruthy();
        }
      }
    }
  });

  it("never talks about banking in another vertical's detail", () => {
    for (const v of VERTICAL_OPTIONS.filter((x) => x.id !== "banking")) {
      const text = JSON.stringify(momentsFor(v.id).flatMap((mo) => mo.steps.map((st) => detailFor(st.key, profileFor(v.id), mo.amount || 25, mo.pay))));
      expect(text, v.id).not.toMatch(/\b(bank|Bank|balance|ledger|Steven|Blake|transfer)\b/);
    }
  });

  it("shows the exchange as PingOne's token endpoint with the token-exchange grant, and the delegated token's sub and act", () => {
    const air = profileFor("airlines");
    const req = detailFor("exchange1-req", air, 25, true);
    expect(req.request).toContain("auth.pingone.com");
    expect(req.request).toContain("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(req.request).toContain("scope=assistant:pay");
    const res = detailFor("exchange1-res", air, 25, true);
    expect(res.token.claims.map((c) => c.claim)).toEqual(expect.arrayContaining(["sub", "act", "aud", "scope"]));
    expect(res.token.idx).toBe(2);
  });

  it("translates the scope at Exchange 2 into the business's own vocabulary", () => {
    const d = detailFor("core-commit", profileFor("airlines"), 25, true);
    expect(d.token.idx).toBe(3);
    expect(d.token.claims.find((c) => c.claim === "scope").value).toBe("change-fee.execute");
  });

  it("the page starts with an idle detail panel, then follows the step", () => {
    render(<AuthorizationFlowPage />);
    expect(screen.getByRole("heading", { name: "Press Simulate, or pick a step" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Read balance/ }));
    fireEvent.click(within(screen.getByTestId("af-step-bar")).getByText("Simulate"));
    fireEvent.click(within(screen.getByTestId("af-step-bar")).getByText("Pause"));
    expect(screen.getByLabelText("Step detail").textContent).toContain("Step 1 of 13");
  });

  it("jumps to a step from the list and lights the right token", () => {
    render(<AuthorizationFlowPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Read balance/ }));
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("button");
    fireEvent.click(steps[4]); // Delegated token: sub, act
    const detail = screen.getByLabelText("Step detail");
    expect(detail.textContent).toContain("Step 5 of 13");
    expect(detail.textContent).toContain("Delegated token");
    const inUse = within(detail).getByText("In use at this step");
    expect(inUse.closest("dd").previousElementSibling.textContent).toContain("Delegated token");
    expect(within(detail).getAllByText("In use at this step")).toHaveLength(1);
    expect(detail.querySelectorAll(".afd__claims tbody tr").length).toBeGreaterThan(3);
  });

  it("marks a refusal as refused and lists a failed check mark style", () => {
    render(<AuthorizationFlowPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Pay \$60/ }));
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("button");
    fireEvent.click(steps[6]); // DENY
    expect(screen.getByLabelText("Step detail").textContent).toContain("Refused");
    expect(screen.getByLabelText("Step detail").querySelector(".afd__checks--no")).toBeTruthy();
  });

  it("moves the detail beside the diagram and back", () => {
    const { container } = render(<AuthorizationFlowPage />);
    expect(container.querySelector(".af-grid--side")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Detail on the side" }));
    expect(container.querySelector(".af-grid--side")).toBeTruthy();
    expect(container.querySelector(".af-grid--side > .afd")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Detail on the side" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Detail on the side" }));
    expect(container.querySelector(".af-grid--side")).toBeNull();
  });
});

describe("AuthorizationFlowPage on the Ping UI Standard", () => {
  it("puts the banner first, inside the page root, before the title band", () => {
    const { container } = render(<AuthorizationFlowPage />);
    const root = container.querySelector(".pu-page.af-page");
    expect(root).toBeTruthy();
    const first = root.firstElementChild;
    expect(first.querySelector("[role='note']")).toBe(screen.getByTestId("af-banner"));
    expect(root.querySelector("h1")).toBeTruthy();
    expect(first.compareDocumentPosition(root.querySelector("h1")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the chosen vertical's business in the banner, and follows a change of vertical", () => {
    render(<AuthorizationFlowPage />);
    expect(screen.getByTestId("af-banner").textContent).toContain(profileFor(DEFAULT_VERTICAL).org);
    fireEvent.change(screen.getByLabelText("Vertical"), { target: { value: "healthcare" } });
    expect(screen.getByTestId("af-banner").textContent).toContain("CareConnect");
  });

  it("has exactly one primary button in every state: idle, running, paused, jumped to a step, done", () => {
    const { container } = render(<AuthorizationFlowPage />);
    const primaries = () => container.querySelectorAll(".pu-btn--primary");
    const bar = () => within(screen.getByTestId("af-step-bar"));
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0].textContent).toBe("Simulate this moment");
    fireEvent.click(primaries()[0]);
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0].textContent).toBe("Restart this moment");
    fireEvent.click(bar().getByText("Pause"));
    expect(primaries()).toHaveLength(1);
    fireEvent.click(within(screen.getByRole("list", { name: "Steps" })).getAllByRole("button")[3]);
    expect(primaries()).toHaveLength(1);
    fireEvent.click(bar().getByText("Stop"));
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0].textContent).toBe("Simulate this moment");
    // no other button wears a primary look: the shared step bar stays secondary
    expect(container.querySelectorAll("[class*='primary']")).toHaveLength(1);
  });

  it("keeps keyboard focus on the primary after it is pressed", () => {
    render(<AuthorizationFlowPage />);
    const go = screen.getByTestId("af-simulate");
    go.focus();
    fireEvent.click(go);
    expect(document.activeElement).toBe(screen.getByTestId("af-simulate"));
    expect(screen.getByTestId("af-simulate").textContent).toBe("Restart this moment");
  });

  it("restarts the walkthrough from the first message", () => {
    render(<AuthorizationFlowPage />);
    fireEvent.click(screen.getByTestId("af-simulate"));
    fireEvent.click(within(screen.getByTestId("af-step-bar")).getByText("Pause"));
    fireEvent.click(within(screen.getByTestId("af-step-bar")).getByText(/Next/));
    fireEvent.click(within(screen.getByTestId("af-step-bar")).getByText(/Next/));
    expect(screen.getByTestId("flow").dataset.edges).toBe("3");
    fireEvent.click(screen.getByTestId("af-simulate"));
    expect(screen.getByTestId("flow").dataset.edges).toBe("1");
  });

  it("marks the selected moment with aria-selected and the toggles with aria-pressed", () => {
    render(<AuthorizationFlowPage />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    fireEvent.click(tabs[3]);
    expect(screen.getAllByRole("tab")[3].getAttribute("aria-selected")).toBe("true");
    for (const name of ["Detail on the side", "Dark diagram"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("gives every chip a word, and never calls a scripted outcome a real result", () => {
    const { container } = render(<AuthorizationFlowPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Pay \$60/ }));
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("button");
    fireEvent.click(steps[6]);
    const chips = [...container.querySelectorAll(".pu-chip")];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.textContent.trim().length, chip.outerHTML).toBeGreaterThan(0);
      expect(chip.className).toContain("pu-chip--neutral");
    }
    expect(screen.getByLabelText("Step detail").textContent).toContain("Refused (scripted)");
    for (let i = 7; i < steps.length; i += 1) fireEvent.click(steps[i]);
    expect(screen.getByRole("status").textContent).toContain("Refused (scripted)");
  });

  it("labels the conversation speakers in text, and the step list marks the current step and refusals", () => {
    const { container } = render(<AuthorizationFlowPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Pay \$60/ }));
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("button");
    fireEvent.click(steps[2]);
    expect(container.querySelector(".af-bubble--user").getAttribute("data-who")).toBe("You");
    expect(steps[2].getAttribute("aria-current")).toBe("step");
    expect(steps.filter((s) => s.getAttribute("aria-current")).length).toBe(1);
    expect(steps.some((s) => /· refusal/.test(s.textContent))).toBe(true);
  });

  it("names every claim cell for the stacked phone layout and lets a long code block scroll by keyboard", () => {
    const { container } = render(<AuthorizationFlowPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Read balance/ }));
    fireEvent.click(within(screen.getByRole("list", { name: "Steps" })).getAllByRole("button")[4]);
    const cells = [...container.querySelectorAll(".afd__claims tbody td")];
    expect(cells.length).toBeGreaterThan(9);
    expect(cells.every((c) => ["Claim", "Value", "What it means"].includes(c.getAttribute("data-label")))).toBe(true);
    const pre = container.querySelector(".afd-code pre");
    expect(pre.getAttribute("tabindex")).toBe("0");
    expect(pre.getAttribute("aria-label")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Copy (request|response)$/ }).length).toBeGreaterThan(0);
  });

  it("has no inline colour or hex literal in the page markup", () => {
    const { container } = render(<AuthorizationFlowPage />);
    for (const el of container.querySelectorAll("[style]")) {
      expect(el.getAttribute("style"), el.outerHTML.slice(0, 80)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl|color|background/i);
    }
  });
});
