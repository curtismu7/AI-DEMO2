// demo_api_ui/src/components/shared/__tests__/MarkdownText.nestedBullet.test.jsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "../MarkdownText";

describe("MarkdownContent", () => {
  it("renders a bullet under a numbered item as a bullet with bold text, not as italics", () => {
    const { container } = render(
      <MarkdownContent text={"1. **Resource:** `prod-db`\n   * **Role:** `admin`"} />,
    );

    expect(container.querySelector("em")).toBeNull();
    expect([...container.querySelectorAll("strong")].map((s) => s.textContent)).toEqual(["Resource:", "Role:"]);
    expect(container.textContent).toContain("• Role: admin");
    expect(container.textContent).not.toContain("*");
  });
});
