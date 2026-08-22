// demo_api_ui/src/components/__tests__/Profile.stalePropSync.test.jsx
//
// Regression: /profile isn't gated on useAuth's `loading` flag, so Profile
// mounts with user=null while the session check is still in flight. Its
// formData/showSuccessScreen useState initializers only run once, so they
// locked onto empty/default values and never picked up the real profile
// once `user` populated on a later render of the same mounted instance —
// clicking "Edit Profile" showed blank fields instead of the real data,
// and saving would have overwritten the real name/email with empty strings.
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Profile from "../Profile";

vi.mock("../../services/bffAxios", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { devices: [] } }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

afterEach(() => {
  cleanup();
});

const REAL_USER = {
  firstName: "Real",
  lastName: "User",
  email: "real.user@example.com",
  phone: "555-0100",
  username: "realuser",
};

it("picks up the real user once auth resolves, instead of locking onto the null-user mount", () => {
  const { rerender } = render(<Profile user={null} />);
  // First render: session check still in flight, matches SignInPrompt branch.
  expect(screen.getByText(/Sign in to view and manage your profile/i)).toBeInTheDocument();

  // useAuth resolves on the next render of the same mounted instance.
  rerender(<Profile user={REAL_USER} />);

  fireEvent.click(screen.getByRole("button", { name: /Edit Profile/i }));

  expect(screen.getByLabelText(/first name/i)).toHaveValue("Real");
  expect(screen.getByLabelText(/last name/i)).toHaveValue("User");
  expect(screen.getByLabelText(/^email$/i)).toHaveValue("real.user@example.com");
  expect(screen.getByLabelText(/phone/i)).toHaveValue("555-0100");
});

it("does not clobber an in-progress edit if the user prop is re-delivered", () => {
  const { rerender } = render(<Profile user={REAL_USER} />);
  fireEvent.click(screen.getByRole("button", { name: /Edit Profile/i }));
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Draft" } });

  // Same user object re-delivered (e.g. an unrelated parent re-render) must
  // not overwrite the field the user is actively editing.
  rerender(<Profile user={{ ...REAL_USER }} />);

  expect(screen.getByLabelText(/first name/i)).toHaveValue("Draft");
});
