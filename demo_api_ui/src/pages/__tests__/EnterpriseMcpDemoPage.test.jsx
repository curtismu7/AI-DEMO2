import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../components/TokenChainFilmstrip", () => ({ default: () => <div data-testid="filmstrip" /> }));

import EnterpriseMcpDemoPage from "../EnterpriseMcpDemoPage";

describe("EnterpriseMcpDemoPage", () => {
  it("renders the token chain and explains both ID-JAG hops", () => {
    render(<EnterpriseMcpDemoPage />);
    expect(screen.getByTestId("filmstrip")).toBeTruthy();
    expect(screen.getAllByText(/ID-JAG issued/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ID-JAG redeemed/i).length).toBeGreaterThan(0);
  });

  it("dispatches the chip with the UC40 identity and makes no shared flag calls", () => {
    const heard = vi.fn();
    window.addEventListener("banking-agent-prefill", heard);
    render(<EnterpriseMcpDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));

    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][0].detail).toEqual({
      message: "show my balance",
      autoSend: true,
      useCaseId: "enterprise-managed-mcp-authorization",
    });
    window.removeEventListener("banking-agent-prefill", heard);
  });

  it("keeps the primary run button high contrast in both themes", () => {
    const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../EnterpriseMcpDemoPage.css");
    const css = fs.readFileSync(cssPath, "utf8");
    const primaryRule = css.match(/\.emd-btn--primary\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(primaryRule).toContain("color: #fff");
    expect(primaryRule).toContain("var(--signin-accent");
  });
});
