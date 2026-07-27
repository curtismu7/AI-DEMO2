import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import IntentBindingLearningPage from "../IntentBindingLearningPage";

beforeEach(() => {
  global.fetch = jest.fn();
});

test("renders the pipeline, the grant, and both columns", () => {
  render(
    <MemoryRouter>
      <IntentBindingLearningPage />
    </MemoryRouter>,
  );
  expect(screen.getAllByText(/RFC 9126/i).length).toBeGreaterThan(0);
  expect(screen.getByText("Within the grant")).toBeInTheDocument();
  expect(screen.getByText("Drifts past the grant")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /run permit/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /run drift/i })).toBeInTheDocument();
});

test("running the permit column posts action:'permit' and shows PERMIT", async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: 200, errorCode: null, reason: "PERMIT — within granted RAR cap",
      tokenChainEvents: [{ id: "intent-binding-verified", label: "Intent Verified (RAR — RFC 9396)", status: "active" }],
    }),
  });

  render(
    <MemoryRouter>
      <IntentBindingLearningPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /run permit/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    "/api/demo/intent-binding/run",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"action":"permit"'),
    }),
  ));
  expect(await screen.findByText(/Intent Verified/i)).toBeInTheDocument();
});

test("running the drift column posts action:'drift' and shows DENY", async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: 403, errorCode: "rar_amount_exceeded",
      reason: "Gateway rejected the call with 403 rar_amount_exceeded",
      tokenChainEvents: [{ id: "sim-gateway-deny", label: "Gateway DENY (rar_amount_exceeded)", status: "error" }],
    }),
  });

  render(
    <MemoryRouter>
      <IntentBindingLearningPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /run drift/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    "/api/demo/intent-binding/run",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"action":"drift"'),
    }),
  ));
  expect(await screen.findByText(/^DENY \(rar_amount_exceeded\)/i)).toBeInTheDocument();
});

test("status boxes use permit green / deny red by column kind", async () => {
  const reason = "PingOne PAR (RFC 9126) is enabled by default. Configure: pingone_par_endpoint";
  global.fetch
    .mockResolvedValueOnce({ ok: false, json: async () => ({ reason }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ reason }) });

  const { container } = render(
    <MemoryRouter>
      <IntentBindingLearningPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /run permit/i }));
  fireEvent.click(screen.getByRole("button", { name: /run drift/i }));

  await waitFor(() => {
    expect(container.querySelector(".ib-col--permit .ib-status--permit")).toBeTruthy();
    expect(container.querySelector(".ib-col--drift .ib-status--deny")).toBeTruthy();
  });
});
