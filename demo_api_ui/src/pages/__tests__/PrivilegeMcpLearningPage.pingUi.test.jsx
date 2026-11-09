import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivilegeMcpLearningPage from "../PrivilegeMcpLearningPage";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("../../hooks/useDividerDrag", () => ({
  default: () => ({ size: 260, handleProps: {} }),
}));

function renderPage(props = {}) {
  return render(
    <MemoryRouter>
      <PrivilegeMcpLearningPage {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  navigate.mockClear();
  vi.restoreAllMocks();
});

describe("PrivilegeMcpLearningPage on the Ping UI Standard", () => {
  it("puts an honest role=note banner before the title band", () => {
    const { container } = renderPage();
    const banner = screen.getByTestId("plp-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner.textContent).toMatch(/nothing on this page calls a gateway/i);
    expect(banner.textContent).toMatch(/not read from the running gateway/i);
    const header = container.querySelector("header.ping-page-header");
    expect(banner.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".pu-page.plp-page")).not.toBeNull();
  });

  it("has exactly one primary button, and it opens the Privilege MCP Client", () => {
    const { container } = renderPage();
    const primaries = container.querySelectorAll(".pu-btn--primary");
    expect(primaries).toHaveLength(1);
    fireEvent.click(primaries[0]);
    expect(navigate).toHaveBeenCalledWith("/privilege-mcp-client");
  });

  it("shows no primary button when embedded in the client's guide modal", () => {
    const { container } = renderPage({ embedded: true });
    expect(container.querySelectorAll(".pu-btn--primary")).toHaveLength(0);
    expect(screen.getByTestId("plp-banner")).toBeInTheDocument();
  });

  it("renders each section through the shared Section: kicker, h2 named by its landmark", () => {
    renderPage();
    const overview = screen.getByRole("region", { name: "Overview" });
    expect(within(overview).getByText("1 · Overview")).toBeInTheDocument();
    expect(screen.getAllByRole("region").length).toBeGreaterThanOrEqual(10);
  });

  it("uses cards, key-value lists and chips that carry a word", () => {
    const { container } = renderPage();
    expect(container.querySelectorAll(".pu-card").length).toBeGreaterThan(5);
    expect(container.querySelectorAll("dl.pu-kv").length).toBeGreaterThanOrEqual(6);
    const chips = [...container.querySelectorAll(".pu-chip")];
    expect(chips.length).toBeGreaterThan(5);
    for (const chip of chips) expect(chip.textContent.trim().length).toBeGreaterThan(0);
    // The old block callouts are gone.
    expect(container.querySelector(".plp-callout")).toBeNull();
  });

  it("labels every table cell with its column so a row stacks on a phone", () => {
    const { container } = renderPage();
    const cells = [...container.querySelectorAll(".plp-table td")];
    expect(cells.length).toBeGreaterThan(20);
    for (const td of cells) expect(td.getAttribute("data-label")).toBeTruthy();
  });

  it("marks the current section in the nav and moves focus to its heading", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Guide sections" });
    expect(within(nav).getByRole("button", { name: /Overview/ })).toHaveAttribute("aria-current", "true");
    const target = within(nav).getByRole("button", { name: /Policies/ });
    fireEvent.click(target);
    expect(target).toHaveAttribute("aria-current", "true");
    expect(within(nav).getByRole("button", { name: /Overview/ })).not.toHaveAttribute("aria-current");
    const heading = screen.getByRole("heading", { level: 2, name: "Policies" });
    expect(heading).toHaveFocus();
  });
});

describe("PrivilegeMcpLearningPage code blocks", () => {
  it("says Copied only after the clipboard accepted the text", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    const btn = screen.getAllByRole("button", { name: /^Copy: / })[0];
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveTextContent("Copied"));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Copied to clipboard")).toBe(true);
  });

  it("reports a refused copy instead of claiming success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    const btn = screen.getAllByRole("button", { name: /^Copy: / })[0];
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveTextContent("Copy failed"));
    expect(btn).not.toHaveTextContent("Copied");
  });
});
