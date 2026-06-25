// banking_api_ui/src/services/__tests__/apiTrafficStore.test.js
//
// Phase 269.1 WR-01 — apiTrafficStore.redactBody must redact the password
// fields used by /api/admin/vault/rotate (currentPassword, newPassword) in
// addition to the existing 'password' key used by /unlock. Without this
// the SPA Traffic Inspector would display rotate passwords in cleartext.

import { redactBody } from "../apiTrafficStore";

describe("apiTrafficStore.redactBody — vault rotate password redaction (WR-01)", () => {
  test("redacts password (unlock body)", () => {
    const out = redactBody({ password: "super-secret-unlock-pw" });
    expect(out.password).toBe("***");
  });

  test("redacts currentPassword + newPassword (rotate body)", () => {
    const out = redactBody({
      currentPassword: "old-vault-pw-12345",
      newPassword: "brand-new-vault-pw-67890",
    });
    expect(out.currentPassword).toBe("***");
    expect(out.newPassword).toBe("***");
  });

  test("redaction is case-insensitive (PascalCase from React state)", () => {
    const out = redactBody({
      CurrentPassword: "x",
      NewPassword: "y",
      Password: "z",
    });
    expect(out.CurrentPassword).toBe("***");
    expect(out.NewPassword).toBe("***");
    expect(out.Password).toBe("***");
  });

  test("passes non-sensitive keys through unchanged", () => {
    const out = redactBody({ vaultPath: "secrets.vault", entriesLoaded: 5 });
    expect(out.vaultPath).toBe("secrets.vault");
    expect(out.entriesLoaded).toBe(5);
  });
});
