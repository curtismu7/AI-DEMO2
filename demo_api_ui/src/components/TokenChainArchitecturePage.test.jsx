// Regression: the page shipped its flowchart in a plain <pre className="mermaid">
// and never called mermaid.render(), so /architecture/token-chain showed the raw
// source. mermaid.render() needs real layout measurement, so it is mocked here
// and the source itself is checked with mermaid.parse (the pattern used by
// PrivilegeGatewayTopologyPage.test.jsx).
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg data-testid='token-chain-svg'></svg>" })),
    parse: vi.fn(async () => true),
  },
}));

import mermaid from "mermaid";
import TokenChainArchitecturePage, { MERMAID_DIAGRAM } from "./TokenChainArchitecturePage";

describe("TokenChainArchitecturePage", () => {
  it("renders the diagram through mermaid instead of dumping the source", async () => {
    render(<TokenChainArchitecturePage />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    expect(mermaid.render.mock.calls[0][1]).toBe(MERMAID_DIAGRAM);
    await waitFor(() =>
      expect(screen.getByTestId("token-chain-svg")).toBeTruthy(),
    );
    expect(document.querySelector("pre.mermaid")).toBeNull();
  });
});
