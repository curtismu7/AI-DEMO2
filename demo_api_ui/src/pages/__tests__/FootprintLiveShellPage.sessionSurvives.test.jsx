import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import FootprintLiveShellPage from "../FootprintLiveShellPage";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

it("keeps the transcript and lands a pending reply after a skin switch", async () => {
  apiClient.get.mockResolvedValue({ data: { oauth: { authenticated: true, scope: "openid" }, tools: [{ name: "t" }] } });
  let resolveChat;
  apiClient.post.mockImplementation(() => new Promise((r) => { resolveChat = r; }));
  localStorage.clear();

  render(
    <MemoryRouter initialEntries={["/demo/coding-agent?v=claude-code"]}>
      <Routes>
        <Route path="/demo/:shellSlug" element={<FootprintLiveShellPage />} />
      </Routes>
    </MemoryRouter>,
  );

  const box = await screen.findByRole("textbox", { name: "Prompt" });
  fireEvent.change(box, { target: { value: "list safes" } });
  fireEvent.submit(box.closest("form"));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/privilege-mcp/chat", { prompt: "list safes" }));

  // Switch to VS Code while the reply is still pending.
  fireEvent.change(screen.getByRole("combobox", { name: "Skin" }), { target: { value: "vscode:classic-dark" } });
  expect(await screen.findByTestId("pvs-vscode")).toBeInTheDocument();
  expect(screen.getByRole("log", { name: "Chat" })).toHaveTextContent("list safes");

  await act(async () => resolveChat({ data: { reply: "Found 1 tool", steps: [] } }));
  expect(screen.getByRole("log", { name: "Chat" })).toHaveTextContent("Found 1 tool");
});
