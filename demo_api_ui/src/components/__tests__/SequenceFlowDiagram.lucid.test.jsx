import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import SequenceFlowDiagram, { Label, buildSequenceFlow } from "../SequenceFlowDiagram";

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
  if (!globalThis.DOMMatrixReadOnly) globalThis.DOMMatrixReadOnly = class { constructor() { this.m22 = 1; } };
});
afterEach(cleanup);

const SRC = `sequenceDiagram
    autonumber
    participant U as User
    participant G as Gateway
    participant P as Policy
    rect rgb(230, 240, 255)
    Note over U,P: Phase 1 - Ask
    U->>G: call it
    G->>G: check token
    end
    rect rgb(255, 243, 223)
    Note over U,P: Phase 2 - Decide
    loop poll
      alt approved
        G->>P: decide
      else pending
        P-->>G: wait
      end
    end
    end`;
const STEPS = [
  { what: "The user calls.", why: "It starts the flow.", request: "POST /mcp HTTP/1.1\nHost: gateway.example.com\n\n{\"jsonrpc\":\"2.0\"}", response: "HTTP/1.1 200 OK\n\n{\"ok\":true}", refs: [{ spec: "RFC 8693", section: "2.1" }] },
  { what: "Checks the token." },
  { what: "Asks policy." },
  { what: "Waits." },
];

describe("buildSequenceFlow, lucid variant", () => {
  const plain = buildSequenceFlow(SRC);
  const lucid = buildSequenceFlow(SRC, [], { variant: "lucid" });
  it("draws a coloured band behind each rect, in the colour the source gave", () => {
    const bands = lucid.nodes.filter((n) => n.type === "band");
    expect(bands.map((b) => b.data.colour)).toEqual(["rgb(230, 240, 255)", "rgb(255, 243, 223)"]);
    expect(bands[0].zIndex).toBeLessThan(0);
    expect(bands[0].position.y).toBeLessThan(lucid.rows[0]);
    expect(bands[0].position.y + bands[0].data.h).toBeGreaterThan(lucid.rows[1]);
    expect(bands[0].position.y + bands[0].data.h).toBeLessThanOrEqual(bands[1].position.y);
  });
  it("draws alt and loop as frames, nested, with the else divider and its title", () => {
    const frames = lucid.nodes.filter((n) => n.type === "frame");
    expect(frames.map((f) => [f.data.kind, f.data.text])).toEqual([["alt", "approved"], ["loop", "poll"]]);
    const [alt, loop] = frames;
    expect(alt.data.elses).toHaveLength(1);
    expect(alt.data.elses[0].text).toBe("pending");
    expect(loop.position.x).toBeLessThan(alt.position.x);
    expect(loop.data.h).toBeGreaterThan(alt.data.h);
    expect(lucid.nodes.some((n) => n.type === "frag")).toBe(false);
  });
  it("numbers messages with a disc instead of a text prefix, and every message can be picked", () => {
    expect(plain.edges[0].data.text).toBe("1. call it");
    expect(lucid.edges[0].data).toMatchObject({ text: "call it", disc: true, n: 1, i: 0 });
    expect(lucid.edges.map((e) => e.data.n)).toEqual([1, 2, 3, 4]);
  });
  it("leaves every other diagram exactly as it was: no band, frame or disc without the variant", () => {
    expect(plain.nodes.some((n) => n.type === "band" || n.type === "frame")).toBe(false);
    expect(plain.nodes.some((n) => n.type === "frag")).toBe(true);
    expect(plain.edges.every((e) => !e.data.disc)).toBe(true);
  });
});

describe("message label", () => {
  const data = { text: "call it\nnow", i: 4 };
  it("is a named button that opens its message when the page gave a pick handler", () => {
    const picked = [];
    render(<Label data={{ ...data, onPick: (i) => picked.push(i) }} />);
    const b = screen.getByRole("button", { name: "Message 5: call it now. Show details" });
    fireEvent.click(b);
    fireEvent.keyDown(b, { key: "Enter" });
    fireEvent.keyDown(b, { key: " " });
    fireEvent.keyDown(b, { key: "a" });
    expect(picked).toEqual([4, 4, 4]);
  });
  it("is plain text, not a button, without a pick handler", () => {
    render(<Label data={data} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/call it/)).toBeInTheDocument();
  });
});

describe("SequenceFlowDiagram, lucid variant", () => {
  it("shows what, why, the request, the response and the standards in the details row of a step", async () => {
    const { container } = render(<SequenceFlowDiagram source={SRC} variant="lucid" stepDetails={STEPS} label="test" />);
    fireEvent.click(container.querySelectorAll(".dreel-card")[0]);
    const detail = await screen.findByTestId("sequence-reel-detail");
    expect(detail).toHaveTextContent("The user calls.");
    expect(detail).toHaveTextContent("It starts the flow.");
    expect(detail).toHaveTextContent("POST /mcp HTTP/1.1");
    expect(detail).toHaveTextContent("HTTP/1.1 200 OK");
    const link = screen.getByRole("link", { name: /RFC 8693 section 2.1/ });
    expect(link).toHaveAttribute("href", "https://www.rfc-editor.org/rfc/rfc8693#section-2.1");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(detail).toHaveTextContent("OAuth 2.0 Token Exchange");
  });
  it("a step with no wire detail shows just its text, and no standards list", async () => {
    const { container } = render(<SequenceFlowDiagram source={SRC} variant="lucid" stepDetails={STEPS} label="test" />);
    fireEvent.click(container.querySelectorAll(".dreel-card")[1]);
    const detail = await screen.findByTestId("sequence-reel-detail");
    expect(detail).toHaveTextContent("Checks the token.");
    expect(screen.queryByTestId("sequence-reel-refs")).toBeNull();
  });
  it("adds the lucid class only for the variant", () => {
    const { container, rerender } = render(<SequenceFlowDiagram source={SRC} variant="lucid" label="test" />);
    expect(container.querySelector(".sfx--lucid")).not.toBeNull();
    rerender(<SequenceFlowDiagram source={SRC} label="test" />);
    expect(container.querySelector(".sfx--lucid")).toBeNull();
  });
});
