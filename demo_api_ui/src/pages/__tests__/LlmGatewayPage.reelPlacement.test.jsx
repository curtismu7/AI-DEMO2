import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LlmGatewayPage from "../LlmGatewayPage";

// The reel sits in TWO places on purpose (placements B and C): a full-width band
// under the header for the call that just happened, and one under each reply so
// scrolling back through a session shows what every call did rather than only
// the last. It deliberately does NOT sit in the Last Decision panel any more —
// three copies of the same component on one page was the thing to avoid.

const CONFIG = {
  lanes: [{ provider: "anthropic", route: "/llm/anthropic/v1/messages", keyConfigured: true }],
  locals: [],
};

function mockFetch(reply) {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes("/llm/config")) {
      return { ok: true, status: 200, text: async () => JSON.stringify(CONFIG) };
    }
    if (String(url).includes("/llm/models")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ models: [] }) };
    }
    return reply();
  });
}

const answered = () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    reply: "Paris.",
    provider: "anthropic",
    route: "/llm/anthropic/v1/messages",
    latencyMs: 300,
    reachedProvider: true,
  }),
});

async function ask(text) {
  const box = await screen.findByPlaceholderText(/ask/i);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /send/i }));
}

// Deliberately NOT deleting global.fetch between tests: an in-flight effect from
// the previous render lands after teardown and throws "fetch is not defined",
// which fails a later test for something the earlier one did. Each test installs
// its own stub, so reassignment is enough.

describe("reel placement", () => {
  it("draws the band under the header once a call has happened", async () => {
    mockFetch(answered);
    render(<LlmGatewayPage />);
    await ask("capital of France?");
    await waitFor(() => expect(document.querySelector(".lgw-reelband")).toBeTruthy());
    expect(document.querySelector(".lgw-reelband")).toHaveTextContent(/Privilege/);
  });

  it("draws a reel under the reply too, so the turn keeps its own evidence", async () => {
    mockFetch(answered);
    render(<LlmGatewayPage />);
    await ask("capital of France?");
    await waitFor(() => expect(document.querySelector(".lgw-turn-group .lgw-reel")).toBeTruthy());
  });

  it("the band is present at rest, so the reel does not appear from nothing", async () => {
    mockFetch(answered);
    render(<LlmGatewayPage />);
    await screen.findByPlaceholderText(/ask/i);
    const band = document.querySelector(".lgw-reelband");
    expect(band).toBeTruthy();
    expect(band).toHaveTextContent(/Waiting for a prompt/);
    // Idle, not pretending a call happened.
    expect(band.querySelectorAll(".lgw-reel__box--idle").length).toBeGreaterThan(0);
  });

  it("no per-turn reel before anything has been sent — there is no turn to explain", async () => {
    mockFetch(answered);
    render(<LlmGatewayPage />);
    await screen.findByPlaceholderText(/ask/i);
    expect(document.querySelector(".lgw-turn-group")).toBeNull();
  });

  it("the reel is a SIBLING of the turn button, never nested inside it", async () => {
    mockFetch(answered);
    render(<LlmGatewayPage />);
    await ask("capital of France?");
    await waitFor(() => expect(document.querySelector(".lgw-turn-group .lgw-reel")).toBeTruthy());
    // A button inside a button is invalid markup and swallows the inner clicks,
    // which would make every box in the transcript reel dead.
    const turnButton = document.querySelector(".lgw-turn--model");
    expect(turnButton.querySelector(".lgw-reel")).toBeNull();
  });

  it("the Last Decision panel no longer carries a third copy", async () => {
    mockFetch(answered);
    render(<LlmGatewayPage />);
    await ask("capital of France?");
    const dec = await screen.findByTestId("lgw-decision");
    expect(dec.querySelector(".lgw-reel")).toBeNull();
  });
});
