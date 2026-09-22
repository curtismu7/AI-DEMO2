import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AgentIdentityAcademyPage from "../AgentIdentityAcademyPage";

const { themeState } = vi.hoisted(() => ({
  themeState: { darkMode: false },
}));

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => themeState,
}));

describe("AgentIdentityAcademyPage", () => {
  it("registers the Academy inside the application route shell", () => {
    const appSource = readFileSync(resolve("src/App.js"), "utf8");

    expect(appSource).toMatch(
      /<Route\s+path="\/academy\/identity"\s+element=\{\s*<AgentIdentityAcademyRoute\b[\s\S]*?\/>\s*\}\s*\/>/,
    );
  });

  it("embeds the standalone Academy without duplicating its prototype header", () => {
    render(<AgentIdentityAcademyPage />);

    expect(screen.getByTitle("Agent Identity Academy lessons")).toHaveAttribute(
      "src",
      "/academy-identity-preview.html?embedded=1",
    );
  });

  it("synchronizes the app theme into the embedded Academy", () => {
    themeState.darkMode = true;
    render(<AgentIdentityAcademyPage />);
    const frame = screen.getByTitle("Agent Identity Academy lessons");
    const postMessage = vi.spyOn(frame.contentWindow, "postMessage");

    fireEvent.load(frame);

    expect(postMessage).toHaveBeenCalledWith(
      { type: "academy-theme", theme: "dark" },
      window.location.origin,
    );
  });
});
