import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import PingFederateIdJagExplainerPage from "../PingFederateIdJagExplainerPage";

describe("PingFederate ID-JAG explainer", () => {
  it("links the explainer to the runnable demo and diagram", () => {
    render(
      <MemoryRouter>
        <PingFederateIdJagExplainerPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("pingfederate-id-jag-explainer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run the demo" })).toHaveAttribute("href", "/pingfederate-id-jag/demo");
    expect(screen.getByRole("link", { name: "Open the diagram" })).toHaveAttribute("href", "/pingfederate-id-jag/diagram");
    expect(screen.getByText("What happens when you run “show my balance”")).toBeInTheDocument();
  });

  it("tells the whole seven-step story, ending at the banking API, and shows the learning path", () => {
    render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(7);
    expect(screen.getByText(/banking API verifies the signature and issuer/)).toBeInTheDocument();
    expect(screen.getByTestId("idjag-path")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See how we built it" })).toHaveAttribute("href", "/pingfederate-id-jag/implementation");
  });

  it("swaps every step to the plain-language story and back", () => {
    render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Explain it simply" }));
    expect(screen.getByText(/permission slip/)).toBeInTheDocument();
    expect(screen.queryByText(/validates PingFederate's signature through its JWKS/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Explain it simply" }));
    expect(screen.getByText(/validates PingFederate's signature through its JWKS/)).toBeInTheDocument();
  });

  it("opens the diagram links in a new tab", () => {
    render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Open the diagram" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "See how we built it" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Run the demo" })).not.toHaveAttribute("target");
  });

  it("opens with an honest explainer banner (role=note) as the first thing in the page", () => {
    const { container } = render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    const root = screen.getByTestId("pingfederate-id-jag-explainer");
    expect(root).toHaveClass("pu-page");
    const banner = screen.getByTestId("pfj-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(root.firstElementChild).toContainElement(banner);
    expect(banner).toHaveTextContent(/nothing on this page runs/i);
    expect(banner).toHaveTextContent(/analogy, not a trace/i);
    // The shell already supplies <main>; a second one nested in it is a landmark error.
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("has exactly one primary action, \"Run the demo\", in both views", () => {
    const { container } = render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    const primaries = () => [...container.querySelectorAll(".pu-btn--primary")].map((el) => el.textContent);
    expect(primaries()).toEqual(["Run the demo"]);
    fireEvent.click(screen.getByRole("button", { name: "Explain it simply" }));
    expect(primaries()).toEqual(["Run the demo"]);
  });

  it("keeps one stable button name and carries the state in aria-pressed only", () => {
    render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    const toggle = screen.getByRole("button", { name: "Explain it simply" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    // Same node, same name: a name swap plus aria-pressed would announce the state twice, inverted.
    expect(screen.getByRole("button", { name: "Explain it simply" })).toBe(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Show the technical version" })).toBeNull();
  });

  it("announces the chosen view in a status region that is mounted before the text changes", () => {
    render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    const live = screen.getByTestId("pfj-view-status");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveTextContent("Technical version");
    expect(live.querySelector(".pu-chip")).toHaveClass("pu-chip--neutral");
    fireEvent.click(screen.getByRole("button", { name: "Explain it simply" }));
    // The very same element, not a new one, so assistive tech announces the change.
    expect(screen.getByTestId("pfj-view-status")).toBe(live);
    expect(live).toHaveTextContent("Plain-language story");
  });

  it("keeps focus on the toggle after the view changes", () => {
    render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    const toggle = screen.getByRole("button", { name: "Explain it simply" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(toggle);
  });

  it("restyles the path bar's current-step pill so it is not a second red fill", () => {
    const css = readFileSync(resolve(__dirname, "../PingFederateIdJagExplainerPage.css"), "utf8");
    expect(css).toMatch(/\.pu-page\.pfj-explainer \.idjag-path \.idjag-path__stops \.is-current a(?:,[^{]*)?\{[^}]*background:\s*var\(--th-bg-card\)[^}]*color:\s*var\(--th-text\)/);
  });

  it("lists the trust boundary as a labelled key-value list", () => {
    const { container } = render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    expect(container.querySelector("dl.pu-kv")).not.toBeNull();
    expect(screen.getByText("PingFederate issues")).toBeInTheDocument();
    expect(screen.getByText("the assertion and issues its local access token")).toBeInTheDocument();
  });
});
