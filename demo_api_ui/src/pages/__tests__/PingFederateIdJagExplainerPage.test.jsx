import { render, screen } from "@testing-library/react";
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
});
