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
});
