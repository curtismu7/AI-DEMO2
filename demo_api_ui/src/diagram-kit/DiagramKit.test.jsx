// The kit's component tests (diagramKit.test.js has the pure ones). They run wherever the kit is vendored.
// React Flow does not render edges in jsdom (nothing is measured), so the arrow's own drawing is checked in a real browser.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactFlow } from "@xyflow/react";
import { EdgeLabels, Passport, PassportActions } from "./DiagramKit.jsx";
import { boxPassport, sidePoint } from "./diagramKit.js";

// React Flow fits the view on a short timer; let it finish before the page is torn down, or it fires into a closed window.
afterEach(async () => { await act(async () => { await new Promise((r) => setTimeout(r, 120)); }); cleanup(); vi.restoreAllMocks(); });

const nodes = [{ id: "a", position: { x: 0, y: 0 }, data: {} }, { id: "b", position: { x: 400, y: 0 }, data: {} }];
const items = [
  { id: "e0", text: "first", source: "a", target: "b", sourceHandle: "r", targetHandle: "l" },
  { id: "e1", text: "second", source: "b", target: "a", sourceHandle: "l", targetHandle: "r", active: true },
  { id: "e2", text: "third", source: "a", target: "b", sourceHandle: "r", targetHandle: "l", dim: true, selected: true },
  { id: "e3", text: "", source: "a", target: "b", sourceHandle: "r", targetHandle: "l" },
];
const mount = (extra = {}) => render(
  <div style={{ width: 800, height: 400 }}>
    <ReactFlow nodes={nodes} edges={[]} fitView><EdgeLabels items={items} pointFor={sidePoint} {...extra} /></ReactFlow>
  </div>,
);
const label = (id) => screen.getByTestId(`dk-label-${id}`);

describe("EdgeLabels", () => {
  it("draws one label per arrow that has text, in a layer above the boxes", () => {
    mount();
    for (const [id, text] of [["e0", "first"], ["e1", "second"], ["e2", "third"]]) { expect(label(id)).toHaveTextContent(text); expect(document.querySelector(".react-flow__viewport-portal").contains(label(id))).toBe(true); }
    expect(screen.queryByTestId("dk-label-e3")).toBeNull(); // no text, no label
  });
  it("marks the active arrow's label and raises it; dim and selected are marked too", () => {
    mount();
    expect(label("e1").className).toContain("dk-label--on"); expect(label("e1").style.zIndex).toBe("3");
    expect(label("e0").className).not.toContain("dk-label--on"); expect(label("e0").style.zIndex).toBe("1");
    expect(label("e2").className).toContain("dk-label--dim"); expect(label("e2").className).toContain("dk-label--sel");
  });
  it("takes no clicks unless asked: labels are clickable only when onSelect is given, and the click names its arrow", () => {
    mount(); expect(label("e0").className).not.toContain("dk-label--click");
    cleanup();
    const onSelect = vi.fn(); mount({ onSelect });
    expect(label("e0").className).toContain("dk-label--click");
    fireEvent.click(label("e1")); expect(onSelect).toHaveBeenCalledTimes(1); expect(onSelect.mock.calls[0][0].id).toBe("e1");
  });
  it("places the labels clear of each other", () => {
    mount();
    const spots = ["e0", "e1", "e2"].map((id) => label(id).style.transform);
    expect(new Set(spots).size).toBe(3); // three arrows between the same two boxes do not share one spot
  });
});

describe("Passport", () => {
  const graph = { repo: { url: "https://github.com/o/r.git", rev: "e".repeat(40) }, groups: { g: { label: "Group G", color: "dark" } },
    nodes: [{ id: "a", label: "Alpha", group: "g", sources: [{ path: "server/src/jobs.js", line: 88, end_line: 97, label: "apply gate" }] }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }],
    edges: [{ source: "a", target: "b", label: "a to b" }, { source: "b", target: "c" }, { source: "b", target: "a", label: "b back" }] };
  const mountPassport = (id = "a", actions = {}) => {
    const acts = { open: vi.fn(), close: vi.fn(), link: (x) => `http://lab.example/?box=${x}`, ...actions }; const outer = vi.fn();
    render(<div onClick={outer}><PassportActions.Provider value={acts}><Passport p={boxPassport(graph, id)} /></PassportActions.Provider></div>);
    return { acts, outer };
  };
  it("shows the group, the source as a link to the pinned commit, the reach and both lists", () => {
    mountPassport();
    expect(screen.getByText("Group G")).toBeInTheDocument();
    const src = screen.getByTestId("dk-passport-sources");
    expect(src).toHaveTextContent("o/r @ eeeeeee"); expect(src).toHaveTextContent("apply gate: server/src/jobs.js:88-97");
    const a = src.querySelector("a"); expect(a.getAttribute("href")).toBe(`https://github.com/o/r/blob/${"e".repeat(40)}/server/src/jobs.js#L88-L97`); expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByTestId("dk-passport-reach")).toHaveTextContent("Upstream 1 · Downstream 2");
    expect(screen.getByTestId("dk-passport-outgoing")).toHaveTextContent("Outgoing · 1"); expect(screen.getByTestId("dk-passport-incoming")).toHaveTextContent("Incoming · 1");
    expect(screen.getByTestId("dk-passport-outgoing").querySelector(".dk-passport-arrow").getAttribute("title")).toBe("a to b");
  });
  it("marks each section for its colour: Source, Reach, Outgoing and Incoming, with upstream and downstream counts of their own", () => {
    mountPassport();
    expect(screen.getByTestId("dk-passport-sources").className).toContain("dk-sec--source");
    expect(screen.getByTestId("dk-passport-reach").className).toContain("dk-sec--reach");
    expect(screen.getByTestId("dk-passport-outgoing").className).toContain("dk-sec--out");
    expect(screen.getByTestId("dk-passport-incoming").className).toContain("dk-sec--in");
    expect(screen.getByTestId("dk-passport-reach").querySelector(".dk-up")).toHaveTextContent("Upstream 1");
    expect(screen.getByTestId("dk-passport-reach").querySelector(".dk-down")).toHaveTextContent("Downstream 2");
  });
  it("leaves out what the box does not have: no chip without a group, no Source without pointers", () => {
    mountPassport("b");
    expect(screen.queryByText("Group G")).toBeNull(); expect(screen.queryByTestId("dk-passport-sources")).toBeNull(); expect(document.querySelector(".dk-passport-chip")).toBeNull();
  });
  it("an item opens the box at the other end, Close closes, and clicks inside never reach the box", () => {
    const { acts, outer } = mountPassport();
    fireEvent.click(within(screen.getByTestId("dk-passport-outgoing")).getByRole("button", { name: "Beta" })); expect(acts.open).toHaveBeenCalledWith("b"); // Beta is also in Incoming, so look in Outgoing
    fireEvent.click(screen.getByTestId("dk-passport-close")); expect(acts.close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("dk-passport-reach")); fireEvent.click(screen.getByTestId("dk-passport-sources").querySelector("a"));
    expect(outer).not.toHaveBeenCalled(); // the surrounding box's click handler never ran
  });
  it("is marked nodrag nopan nowheel, so using it never moves the box or pans the canvas", () => {
    mountPassport(); const el = screen.getByTestId("dk-passport-a"); for (const c of ["nodrag", "nopan", "nowheel"]) expect(el.classList.contains(c)).toBe(true);
  });
  it("Copy link puts the box's link on the clipboard; when nothing can write there, the link is shown to copy by hand", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mountPassport();
    await act(async () => { fireEvent.click(screen.getByTestId("dk-passport-copy")); });
    expect(writeText).toHaveBeenCalledWith("http://lab.example/?box=a"); expect(screen.getByTestId("dk-passport-copy")).toHaveTextContent("Copied");
    cleanup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    document.execCommand = vi.fn(() => false);
    mountPassport("b");
    await act(async () => { fireEvent.click(screen.getByTestId("dk-passport-copy")); });
    expect(screen.getByTestId("dk-passport-url").value).toBe("http://lab.example/?box=b");
  });
});
