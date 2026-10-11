import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import {
  EducationUIProvider,
  useEducationUI,
} from "../../context/EducationUIContext";
import OAuthTokenExchangeLessonPage from "../OAuthTokenExchangeLessonPage";

function EducationState() {
  const { panel, tab } = useEducationUI();
  return <output aria-label="Education selection">{`${panel || "none"}:${tab || "none"}`}</output>;
}

function renderLesson() {
  return render(
    <MemoryRouter>
      <EducationUIProvider>
        <OAuthTokenExchangeLessonPage />
        <EducationState />
      </EducationUIProvider>
    </MemoryRouter>,
  );
}

describe("OAuthTokenExchangeLessonPage", () => {
  it("teaches the token exchange story as a sales-engineer-ready request path", () => {
    renderLesson();

    expect(screen.getByRole("heading", { name: /turn one user session into the right token/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "User session" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "RFC 8693 exchange" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scoped MCP token" })).toBeInTheDocument();
    // The walkthrough diagram carries the shared movie reel (walk-driven).
    expect(screen.getByTestId("ote-exchange-diagram-steps")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open the live token exchange/i })).toHaveAttribute(
      "href",
      "/token-exchange-tester",
    );
  });

  it("makes the live-versus-mock demo boundary explicit", () => {
    renderLesson();

    expect(screen.getByRole("heading", { name: /what you can show in the room/i })).toBeInTheDocument();
    expect(screen.getByText(/live: run the exchange against the configured PingOne tenant/i)).toBeInTheDocument();
    expect(screen.getByText(/mock: use the recorded chain when credentials or network access are unavailable/i)).toBeInTheDocument();
  });

  it("shows the authorization decision and delegated execution proof", () => {
    renderLesson();

    expect(screen.getByRole("heading", { name: /gateway authorization and proof/i })).toBeInTheDocument();
    expect(screen.getByText(/PingOne Agent Gateway validates aud, scope, and act/i)).toBeInTheDocument();
    expect(screen.getByText(/pingone authorize returns permit, deny, or step-up/i)).toBeInTheDocument();
    expect(screen.getByText(/tool executes only after permit/i)).toBeInTheDocument();
    expect(screen.getByText(/deny or step-up/i)).toBeInTheDocument();
  });

  it("opens the matching Education Hub topic from the lesson", async () => {
    const user = userEvent.setup();
    renderLesson();

    await user.click(screen.getByRole("button", { name: /open RFC 8693 in Education Hub/i }));

    expect(screen.getByLabelText("Education selection")).toHaveTextContent("rfc-8693:overview");
  });

  it("links to the related app lesson and authoritative references", () => {
    renderLesson();

    expect(screen.getByRole("link", { name: /continue in OAuth Academy/i })).toHaveAttribute(
      "href",
      "/oauth-academy",
    );
    expect(screen.getByRole("link", { name: /read RFC 8693/i })).toHaveAttribute(
      "href",
      "https://www.rfc-editor.org/rfc/rfc8693",
    );
    expect(screen.getByRole("link", { name: /explore PingOne AI agents/i })).toHaveAttribute(
      "href",
      "https://docs.pingidentity.com/pingone/ai_agents/p1_ai_agents.html",
    );
  });
});
