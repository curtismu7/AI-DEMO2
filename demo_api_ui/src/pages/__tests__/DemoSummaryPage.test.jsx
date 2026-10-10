import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import DemoSummaryPage from "../DemoSummaryPage";

const renderPage = () =>
  render(
    <MemoryRouter>
      <DemoSummaryPage />
    </MemoryRouter>,
  );

describe("DemoSummaryPage", () => {
  it("lists catalog pages with links to their routes", async () => {
    renderPage();
    // Weather MCP is a known catalog entry; its blurb and route must be linked.
    const link = await screen.findByRole("link", { name: /Weather MCP/i });
    expect(link).toHaveAttribute("href", "/weather-mcp");
    // The one-line "what it demos" blurb is shown.
    expect(screen.getByText(/Miami is denied/i)).toBeInTheDocument();
  });

  it("hides non-demo entries: external tools, redirect stubs, dev pages", () => {
    renderPage();
    // PAC Editor's "route" is an external local tool, not an app route.
    expect(screen.queryByText("PAC Editor")).not.toBeInTheDocument();
    // Redirect stubs duplicate their target page ("Same as ..." demos).
    expect(screen.queryByText("DaVinci Login")).not.toBeInTheDocument();
    // Dev-only pages are on the explicit hide list.
    expect(screen.queryByText("Code Explorer")).not.toBeInTheDocument();
  });

  it("filters groups by search query", async () => {
    renderPage();
    await screen.findByRole("link", { name: /Weather MCP/i });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "weather" } });
    expect(screen.getByRole("link", { name: /Weather MCP/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Security Dashboard/i })).not.toBeInTheDocument();
  });
});
