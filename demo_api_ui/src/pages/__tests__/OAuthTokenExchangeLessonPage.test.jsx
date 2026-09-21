import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OAuthTokenExchangeLessonPage from "../OAuthTokenExchangeLessonPage";

describe("OAuthTokenExchangeLessonPage", () => {
  it("teaches the token exchange story as a sales-engineer-ready request path", () => {
    render(
      <MemoryRouter>
        <OAuthTokenExchangeLessonPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /turn one user session into the right token/i })).toBeInTheDocument();
    expect(screen.getByText("User session")).toBeInTheDocument();
    expect(screen.getByText("RFC 8693 exchange")).toBeInTheDocument();
    expect(screen.getByText("Scoped MCP token")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open the live token exchange/i })).toHaveAttribute(
      "href",
      "/token-exchange-tester",
    );
  });

  it("makes the live-versus-mock demo boundary explicit", () => {
    render(
      <MemoryRouter>
        <OAuthTokenExchangeLessonPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /what you can show in the room/i })).toBeInTheDocument();
    expect(screen.getByText(/live: run the exchange against the configured PingOne tenant/i)).toBeInTheDocument();
    expect(screen.getByText(/mock: use the recorded chain when credentials or network access are unavailable/i)).toBeInTheDocument();
  });
});
