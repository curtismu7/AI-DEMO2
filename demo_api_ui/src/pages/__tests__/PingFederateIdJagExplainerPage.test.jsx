import { fireEvent, render, screen } from "@testing-library/react";
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
    fireEvent.click(screen.getByRole("button", { name: "Show the technical version" }));
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

  it("marks the chosen view with aria-pressed and a word chip, never colour alone", () => {
    render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    const toggle = screen.getByRole("button", { name: "Explain it simply" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Technical version")).toHaveClass("pu-chip");
    fireEvent.click(toggle);
    const back = screen.getByRole("button", { name: "Show the technical version" });
    expect(back).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Plain-language story")).toHaveClass("pu-chip");
  });

  it("lists the trust boundary as a labelled key-value list", () => {
    const { container } = render(<MemoryRouter><PingFederateIdJagExplainerPage /></MemoryRouter>);
    expect(container.querySelector("dl.pu-kv")).not.toBeNull();
    expect(screen.getByText("PingFederate issues")).toBeInTheDocument();
    expect(screen.getByText("the assertion and issues its local access token")).toBeInTheDocument();
  });
});
