import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import IdJagRunnerLabPage from "../IdJagRunnerLabPage";

describe("IdJagRunnerLabPage", () => {
  it("renders the lab CTA with the proxy domain URL and the four acts", () => {
    render(
      <MemoryRouter>
        <IdJagRunnerLabPage />
      </MemoryRouter>,
    );
    const cta = screen.getByRole("link", { name: /Open the ID-JAG Runner Lab/i });
    expect(cta).toHaveAttribute("href", "https://local.ping-devops.com:8443/idjag-runner/");
    expect(cta).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/Authorization server 1 \(PingFederate as IdP\)/)).toBeTruthy();
    expect(screen.getByText(/Authorization server 2 \(resource AS\)/)).toBeTruthy();
    expect(screen.getByText(/introspection then shows exactly what the API would learn/i)).toBeTruthy();
  });
});
