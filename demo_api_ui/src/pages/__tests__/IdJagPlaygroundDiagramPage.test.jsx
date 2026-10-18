import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import IdJagPlaygroundDiagramPage from "../IdJagPlaygroundDiagramPage";
import { PLAYGROUND_DIAGRAMS, PLAYGROUND_DIAGRAM_MODES, playgroundDiagramPath, stepParts } from "../../utils/idJagPlaygroundDiagrams";
import { isDiagramPath } from "../../utils/diagramLinks";

const ROUTE = "/pingfederate-id-jag/playground/diagram/:mode";
const open = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path={ROUTE} element={<IdJagPlaygroundDiagramPage />} /></Routes>
  </MemoryRouter>,
);
const pressed = () => screen.getAllByRole("button", { pressed: true }).map((b) => b.textContent);

describe("ID-JAG playground diagram data", () => {
  it.each(PLAYGROUND_DIAGRAM_MODES)("%s: every edge joins two actors and every step 1-5 has a call", (mode) => {
    const d = PLAYGROUND_DIAGRAMS[mode];
    const ids = new Set(d.nodes.map((n) => n.id));
    for (const e of d.edges) {
      expect(ids.has(e.from) && ids.has(e.to), e.id).toBe(true);
      expect(e.fh).toMatch(/^[TBLR][123]$/);
      expect(e.th).toMatch(/^[TBLR][123]$/);
    }
    expect(d.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    for (const n of [1, 2, 3, 4, 5]) expect(stepParts(d, n).edges.length, `step ${n}`).toBeGreaterThan(0);
  });

  it("shows where trust comes from as dashed JWKS reads, and the mode gotchas", () => {
    const dashed = (mode) => PLAYGROUND_DIAGRAMS[mode].edges.filter((e) => e.dashed).map((e) => e.label).join(" | ");
    expect(dashed("oauth-mcp")).toMatch(/JWKS/);
    expect(dashed("pf-pf")).toMatch(/single key/);
    expect(dashed("byo")).toMatch(/trusted-idps\/registry/);
    const notes = (mode) => PLAYGROUND_DIAGRAMS[mode].notes.map((n) => n.text).join(" ");
    expect(notes("pf-pf")).toMatch(/single-key JWKS/);
    expect(notes("byo")).toMatch(/Trusted IdPs registry/);
  });

  it("lights the browser's button press but zooms to the real hop", () => {
    const parts = stepParts(PLAYGROUND_DIAGRAMS["oauth-mcp"], 3);
    expect(parts.nodes).toContain("browser");
    expect(parts.focus).toEqual(["bff", "mcpas", "pf"]);
    expect(stepParts(PLAYGROUND_DIAGRAMS.mock, 1).focus).toEqual(["browser", "mockapi", "n-mock"]);
  });

  it("builds diagram paths that open in a new tab", () => {
    expect(playgroundDiagramPath("pf-pf", 3)).toBe("/pingfederate-id-jag/playground/diagram/pf-pf?step=3");
    for (const mode of PLAYGROUND_DIAGRAM_MODES) expect(isDiagramPath(playgroundDiagramPath(mode, 2))).toBe(true);
    expect(isDiagramPath("/pingfederate-id-jag/playground")).toBe(false);
  });
});

describe("ID-JAG playground diagram page", () => {
  it.each(PLAYGROUND_DIAGRAM_MODES)("%s renders its actors and every call on the overview", (mode) => {
    const d = PLAYGROUND_DIAGRAMS[mode];
    const { container } = open(playgroundDiagramPath(mode));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(d.label);
    const titles = [...container.querySelectorAll(".card .ct")].map((el) => el.textContent);
    expect(titles).toEqual(d.nodes.map((n) => n.title));
    expect(screen.getByTestId("pgd-calls").querySelectorAll("li")).toHaveLength(d.edges.length);
    expect(pressed()).toEqual(["Overview"]);
  });

  it("?step=N lights that step: its calls, its actors and nothing else", () => {
    const { container } = open(playgroundDiagramPath("pf-pf", 3));
    expect(pressed()).toEqual(["3 · Redeem at the local PingFederate"]);
    const calls = screen.getByTestId("pgd-calls").textContent;
    expect(calls).toMatch(/RFC 7523 jwt-bearer · client_id ai-demo-pf-idjag-redeemer/);
    expect(calls).not.toMatch(/tools\/list/);
    const lit = [...container.querySelectorAll(".card.on .ct")].map((el) => el.textContent).sort();
    expect(lit).toEqual(["BFF · the OAuth client", "Browser", "Local PingFederate · resource AS", "SE PingFederate · issuer"]);
  });

  it("Next and Back step through, and the mode switcher keeps the step", () => {
    open(playgroundDiagramPath("oauth-mcp", 1));
    fireEvent.click(screen.getByRole("button", { name: "Next ▶" }));
    expect(pressed()).toEqual(["2 · Get an ID-JAG from PingFederate"]);
    fireEvent.click(screen.getByRole("button", { name: "◀ Back" }));
    expect(pressed()).toEqual(["1 · Sign in with PingFederate"]);
    const byo = screen.getByRole("link", { name: "Your IdP → our resource AS" });
    expect(byo).toHaveAttribute("href", "/pingfederate-id-jag/playground/diagram/byo?step=1");
    expect(screen.getByRole("link", { name: "PingFederate → oauth-mcp" })).toHaveAttribute("aria-current", "page");
  });

  it("falls back to the oauth-mcp diagram for an unknown mode", () => {
    open("/pingfederate-id-jag/playground/diagram/nope");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("PingFederate → oauth-mcp");
  });
});

describe("ID-JAG playground diagram route plumbing", () => {
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

  it("is registered in App.js and public in auth-requirements.json", () => {
    expect(read("src/App.js")).toContain('path="/pingfederate-id-jag/playground/diagram/:mode"');
    const auth = JSON.parse(read("../demo_api_server/config/auth-requirements.json"));
    expect(auth.routes["/pingfederate-id-jag/playground/diagram/:mode"]).toBe("public");
  });
});
