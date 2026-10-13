// demo_api_ui/src/components/__tests__/ProviderSelector.test.jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProviderSelector from "../ProviderSelector";

describe("ProviderSelector", () => {
  it("leads with llama.cpp then Groq, offers no Google, and selects Groq", () => {
    const onSelect = vi.fn();
    render(<ProviderSelector provider="llamacpp" onSelect={onSelect} groqStatus="available" />);

    const labels = screen.getAllByRole("button").map((b) => b.firstChild.textContent);
    expect(labels.slice(0, 2)).toEqual(["llama.cpp", "Groq"]);
    expect(labels).not.toContain("Google");

    fireEvent.click(screen.getByRole("button", { name: /Groq/ }));
    expect(onSelect).toHaveBeenCalledWith("groq");
  });
});
