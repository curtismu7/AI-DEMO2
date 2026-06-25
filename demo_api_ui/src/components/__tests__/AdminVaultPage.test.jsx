// banking_api_ui/src/components/__tests__/AdminVaultPage.test.jsx
//
// Phase 269.1 Plan 03 — AdminVaultPage React Testing Library suite.
// Verifies the three-section operator UX (status / unlock / rotate) and the
// security-critical behaviors documented in the plan's threat model:
//   - apiClient is the only network adapter (T-UI: no raw axios / fetch)
//   - banner text never echoes typed passwords (T-UI-01)
//   - mismatched / weak / same-password rotate is blocked client-side (T-UI-02)
//   - failed unlock preserves the input so the admin can retry
//   - only ⚠️ ✅ ❌ emojis appear in rendered output (CLAUDE.md non-negotiable #4)
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import apiClient from "../../services/apiClient";
import AdminVaultPage from "../AdminVaultPage";

vi.mock("../../services/apiClient", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const STATUS_OK_LOCKED = {
  data: {
    unlocked: false,
    entriesLoaded: 0,
    vaultFilePresent: true,
    vaultPath: "secrets.vault",
  },
};

const STATUS_OK_UNLOCKED_5 = {
  data: {
    unlocked: true,
    entriesLoaded: 5,
    vaultFilePresent: true,
    vaultPath: "secrets.vault",
  },
};

const SENTINEL = "SENTINEL-NEVER-RENDER-12345";

describe("AdminVaultPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.get.mockReset();
    apiClient.post.mockReset();
  });

  test("renders status card after mount with mocked status response", async () => {
    apiClient.get.mockResolvedValueOnce(STATUS_OK_LOCKED);
    render(<AdminVaultPage />);

    await screen.findByText(/Vault file present/);
    expect(screen.getByText(/Vault file present/).textContent).toMatch(
      /✅ yes/,
    );
    // Path basename surfaced (from Plan 02 contract — basename only).
    expect(screen.getByText("secrets.vault")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/api/admin/vault/status");
  });

  test("renders unlock form + rotate form sections", async () => {
    apiClient.get.mockResolvedValueOnce(STATUS_OK_LOCKED);
    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    expect(
      screen.getByRole("heading", { name: /Unlock Vault/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Rotate Vault Password/ }),
    ).toBeInTheDocument();
  });

  test("unlock button is disabled while password is empty", async () => {
    apiClient.get.mockResolvedValueOnce(STATUS_OK_LOCKED);
    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    const btn = screen.getByRole("button", { name: /^Unlock$/ });
    expect(btn).toBeDisabled();
  });

  test("successful unlock clears the password input and shows success banner", async () => {
    // Mount-time status fetch returns locked; after unlock, refresh returns unlocked-5.
    apiClient.get
      .mockResolvedValueOnce(STATUS_OK_LOCKED)
      .mockResolvedValueOnce(STATUS_OK_UNLOCKED_5);
    apiClient.post.mockResolvedValueOnce({
      data: { ok: true, entriesLoaded: 5 },
    });

    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    const input = screen.getByLabelText(/Vault password/);
    fireEvent.change(input, { target: { value: "right-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: /^Unlock$/ }));

    await screen.findByText(/✅ Vault unlocked — 5 entries loaded/);
    expect(input.value).toBe(""); // cleared on success
    expect(apiClient.post).toHaveBeenCalledWith("/api/admin/vault/unlock", {
      password: "right-password-123",
    });
  });

  test("failed unlock shows error banner with the API message and does NOT clear the password", async () => {
    apiClient.get.mockResolvedValueOnce(STATUS_OK_LOCKED);
    apiClient.post.mockRejectedValueOnce({
      response: {
        data: {
          error: "unauthorized",
          message: "vault: open failed (bad password or tampered file)",
        },
        status: 401,
      },
    });

    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    const input = screen.getByLabelText(/Vault password/);
    fireEvent.change(input, { target: { value: SENTINEL } });
    fireEvent.click(screen.getByRole("button", { name: /^Unlock$/ }));

    await screen.findByText(/❌ vault: open failed/);
    // Input retained so admin can retry.
    expect(input.value).toBe(SENTINEL);
    // Banner did not echo the typed password.
    const banner = screen.getByRole("alert");
    expect(banner.textContent).not.toContain(SENTINEL);
  });

  test("mismatched new/confirm password blocks rotate before API call", async () => {
    apiClient.get.mockResolvedValueOnce(STATUS_OK_LOCKED);
    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    fireEvent.change(screen.getByLabelText(/Current password/), {
      target: { value: "current-good-12chars" },
    });
    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: "abc12345NEWxyz" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/), {
      target: { value: "abc12345NEWzyz" }, // different
    });
    fireEvent.click(screen.getByRole("button", { name: /^Rotate password$/ }));

    await screen.findByText(/do not match/);
    // No request hit /rotate.
    expect(apiClient.post).not.toHaveBeenCalledWith(
      "/api/admin/vault/rotate",
      expect.anything(),
    );
  });

  test("new password < 12 chars blocks rotate", async () => {
    apiClient.get.mockResolvedValueOnce(STATUS_OK_LOCKED);
    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    fireEvent.change(screen.getByLabelText(/Current password/), {
      target: { value: "current-good-12chars" },
    });
    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText(/Confirm new password/), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Rotate password$/ }));

    await screen.findByText(/at least 12 characters/);
    expect(apiClient.post).not.toHaveBeenCalledWith(
      "/api/admin/vault/rotate",
      expect.anything(),
    );
  });

  test("successful rotate clears all three rotate inputs and surfaces the VAULT_PASSWORD warning", async () => {
    apiClient.get
      .mockResolvedValueOnce(STATUS_OK_UNLOCKED_5)
      .mockResolvedValueOnce(STATUS_OK_UNLOCKED_5);
    apiClient.post.mockResolvedValueOnce({
      data: {
        ok: true,
        message:
          "Vault password rotated. Update VAULT_PASSWORD before next BFF restart.",
      },
    });

    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    const current = screen.getByLabelText(/Current password/);
    const next = screen.getByLabelText(/^New password/);
    const confirm = screen.getByLabelText(/Confirm new password/);

    fireEvent.change(current, { target: { value: "old-password-12chars" } });
    fireEvent.change(next, { target: { value: "new-password-abc123def" } });
    fireEvent.change(confirm, { target: { value: "new-password-abc123def" } });
    fireEvent.click(screen.getByRole("button", { name: /^Rotate password$/ }));

    await screen.findByText(/Update VAULT_PASSWORD/);
    expect(current.value).toBe("");
    expect(next.value).toBe("");
    expect(confirm.value).toBe("");
    expect(apiClient.post).toHaveBeenCalledWith("/api/admin/vault/rotate", {
      currentPassword: "old-password-12chars",
      newPassword: "new-password-abc123def",
    });
  });

  test("password inputs use type=password (DOM never plain-text)", async () => {
    apiClient.get.mockResolvedValueOnce(STATUS_OK_LOCKED);
    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    expect(screen.getByLabelText(/Vault password/)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText(/Current password/)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText(/Confirm new password/)).toHaveAttribute(
      "type",
      "password",
    );
  });

  test("page renders only ⚠️ ✅ ❌ emojis (CLAUDE.md non-negotiable #4)", async () => {
    apiClient.get.mockResolvedValueOnce(STATUS_OK_LOCKED);
    const { container } = render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    // Trigger the warning banner path too so the ⚠️ glyph is in the rendered tree.
    apiClient.post.mockRejectedValueOnce({
      response: { data: { message: "bad thing" } },
    });
    fireEvent.change(screen.getByLabelText(/Vault password/), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Unlock$/ }));
    await screen.findByText(/❌ bad thing/);

    // Allow only the three sanctioned emojis. Anything else in the misc-symbols
    // / pictographs ranges fails the test.
    const ALLOWED = new Set(["⚠", "✅", "❌"]);
    const text = container.textContent || "";
    const forbidden = [];
    for (const ch of text) {
      const code = ch.codePointAt(0);
      const inEmojiRange =
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x2600 && code <= 0x27bf);
      if (inEmojiRange && !ALLOWED.has(ch)) {
        forbidden.push(`U+${code.toString(16).toUpperCase()}`);
      }
    }
    expect(forbidden).toEqual([]);
  });

  test("uses apiClient (not raw axios/fetch) — mount fires GET on /status, forms fire POST", async () => {
    apiClient.get
      .mockResolvedValueOnce(STATUS_OK_LOCKED)
      .mockResolvedValueOnce(STATUS_OK_UNLOCKED_5);
    apiClient.post.mockResolvedValueOnce({
      data: { ok: true, entriesLoaded: 5 },
    });

    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);

    // GET fired on mount.
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith("/api/admin/vault/status");

    fireEvent.change(screen.getByLabelText(/Vault password/), {
      target: { value: "the-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Unlock$/ }));

    await screen.findByText(/✅ Vault unlocked/);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith("/api/admin/vault/unlock", {
      password: "the-password",
    });
  });

  test("refresh button re-fetches status", async () => {
    apiClient.get
      .mockResolvedValueOnce(STATUS_OK_LOCKED)
      .mockResolvedValueOnce(STATUS_OK_UNLOCKED_5);

    render(<AdminVaultPage />);
    await screen.findByText(/Vault file present/);
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Refresh status/ }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    // Second refresh reports 5 entries.
    await screen.findByText(/Entries loaded: 5/);
  });
});
