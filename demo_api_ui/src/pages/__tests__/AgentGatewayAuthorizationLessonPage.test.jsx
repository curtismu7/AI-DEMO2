import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AgentGatewayAuthorizationLessonPage from "../AgentGatewayAuthorizationLessonPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <AgentGatewayAuthorizationLessonPage />
    </MemoryRouter>,
  );
}

describe("AgentGatewayAuthorizationLessonPage", () => {
  it("teaches the gateway and policy decision roles", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /secure agent access/i })).toBeInTheDocument();
    expect(screen.getAllByText("Agent Gateway", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("PingOne Authorize", { exact: true }).length).toBeGreaterThan(0);
  });

  it("runs scenarios and exposes the selected decision request", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /transfer \$500/i }));
    expect(screen.getAllByText("STEP-UP", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText(/stronger user verification/i)).toBeInTheDocument();
    expect(screen.getByText(/create_transfer/)).toBeInTheDocument();
  });

  it("updates the explanation when a flow stage is selected", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /protected resource/i }));
    expect(screen.getByText(/receives the request only after the gateway gets a permitted decision/i)).toBeInTheDocument();
  });
});
