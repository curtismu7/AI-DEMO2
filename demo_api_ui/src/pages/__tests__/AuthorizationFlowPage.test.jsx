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
    expect(screen.getByText(/scripted walkthrough/)).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));
    expect(canvas().dataset.afTheme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Light mode" }));
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
    expect(detail.querySelector(".afd__tok--live").textContent).toContain("Delegated token");
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
    fireEvent.click(screen.getByRole("button", { name: "Detail below" }));
    expect(container.querySelector(".af-grid--side")).toBeNull();
  });
});
