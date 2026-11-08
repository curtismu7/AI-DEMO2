// KB-1 / KB-10: the shell's keyboard and landmark contract, pinned where jsdom can see it.
// The real Tab counts live in tests/e2e/shell-keyboard.spec.js.
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

vi.mock("../components/TopNav", () => ({ default: () => <header data-testid="topnav" /> }));
vi.mock("../utils/authUi", () => ({ navigateToCustomerOAuthLogin: vi.fn() }));
vi.mock("../utils/roleSwitch", () => ({ startRoleSwitch: vi.fn() }));
vi.mock("../components/ForgotPasswordFlow", () => ({ ForgotPasswordLink: () => null }));

import SignInRequired from "../routes/SignInRequired";
import SignInPrompt from "../components/SignInPrompt";
import { LessonLayout } from "../components/lesson";
import { ThemeProvider } from "../context/ThemeContext";

const appSrc = readFileSync(path.resolve(__dirname, "../App.js"), "utf8");

describe("App.js DOM order", () => {
  it("renders the skip link before every other shell element", () => {
    const body = appSrc.slice(appSrc.indexOf('className={`App end-user-nano'));
    expect(body.indexOf("<SkipLink />")).toBeGreaterThan(-1);
    expect(body.indexOf("<SkipLink />")).toBeLessThan(body.indexOf("<OfflineBanner />"));
    expect(body.indexOf("<SkipLink />")).toBeLessThan(body.indexOf("<AdminSideNav"));
  });

  it("renders the Draw control after the routed page, so it is not the first tab stop", () => {
    expect(appSrc.match(/<DrawOverlay \/>/g)).toHaveLength(1);
    expect(appSrc.indexOf("<DrawOverlay />")).toBeGreaterThan(appSrc.indexOf("</Routes>"));
    expect(appSrc.indexOf("<DrawOverlay />")).toBeGreaterThan(appSrc.indexOf("<AdminSideNav"));
  });

  it("does not nest a <main> inside the AppShell main on the /ai-products routes", () => {
    expect(appSrc).not.toContain('<main className="ai-product-main">');
  });
});

describe("signed-out gate", () => {
  it("renders a single main with an h1", () => {
    render(<MemoryRouter><SignInRequired /></MemoryRouter>);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Sign in required" })).toBeInTheDocument();
  });

  it("keeps the in-panel prompt an h3 by default", () => {
    render(<SignInPrompt message="x" />);
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("lesson layout", () => {
  it("does not add a second main landmark under the page's own", () => {
    render(
      <ThemeProvider>
        <main>
          <LessonLayout title="T" sections={[{ id: "a", label: "A" }]}>
            <p>body</p>
          </LessonLayout>
        </main>
      </ThemeProvider>,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "T" })).toBeInTheDocument();
  });
});
