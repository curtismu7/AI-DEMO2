import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OboSwapDiagram, { NODES, EDGES } from "../OboSwapDiagram";

describe("OboSwapDiagram", () => {
  it("names the four actors and the refusal of the user token", () => {
    const labels = NODES.map((n) => n.data.label);
    expect(labels).toEqual(["Claude (OAuth client)", "OBO MCP endpoint (BFF)", "PingOne", "Downstream API"]);
    expect(EDGES.some((e) => /401/.test(e.label))).toBe(true);
  });

  it("shows the exchange and the delegated token claims on the edges", () => {
    const text = EDGES.map((e) => e.label).join(" | ");
    expect(text).toMatch(/RFC 8693/);
    expect(text).toMatch(/act/);
  });

  it("mounts with an accessible name and no token text", () => {
    render(<OboSwapDiagram />);
    expect(screen.getByLabelText(/token swap diagram/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/eyJ/);
  });
});
