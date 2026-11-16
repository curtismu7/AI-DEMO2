import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FormJsonToggle, { flattenPayload } from "../shared/FormJsonToggle";
import JsonHighlight from "../shared/JsonHighlight";

describe("flattenPayload", () => {
  it("names every leaf by its JS path and drops nothing", () => {
    expect(
      flattenPayload({ act: { sub: "agent-001" }, scope: ["read", "write"], exp: 900 }),
    ).toEqual([
      ["act.sub", "agent-001"],
      ["scope[0]", "read"],
      ["scope[1]", "write"],
      ["exp", "900"],
    ]);
  });

  // An empty container is a fact about the payload, not an absence to skip:
  // dropping it would make `{"errors": []}` render identically to `{}`.
  it("keeps empty containers and nulls as their own row", () => {
    expect(flattenPayload({ errors: [], meta: {}, act: null })).toEqual([
      ["errors", "[]"],
      ["meta", "{}"],
      ["act", "null"],
    ]);
  });
});

describe("FormJsonToggle", () => {
  // The Form | JSON choice is now the page-wide one, kept in localStorage: a click in one test must not
  // become the saved choice that wins in the next.
  beforeEach(() => window.localStorage.clear());

  const VALUE = { scope: "write", act: { sub: "agent-001" } };

  it("opens on the requested view and switches to the other", async () => {
    render(<FormJsonToggle value={VALUE} ariaLabel="Response view" defaultView="json" />);
    expect(screen.getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("act.sub")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Form" }));
    expect(screen.getByText("act.sub")).toBeVisible();
    expect(screen.getByText("agent-001")).toBeVisible();
  });

  it("shares the page-wide Form | JSON choice with the JSON panes, and its JSON view adds no second switch", async () => {
    const { container } = render(
      <>
        <FormJsonToggle value={VALUE} ariaLabel="Response view" />
        <JsonHighlight value={{ other: 1 }} />
      </>,
    );
    // Form is the default for both.
    expect(container.querySelector(".fjt-form")).toBeTruthy();
    expect(container.querySelector(".jp-form")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "JSON" })[0]);
    // One click switched both, and the pane inside the toggle's JSON view has no switch of its own.
    expect(container.querySelector(".fjt .jp-raw")).toBeTruthy();
    expect(container.querySelector(".fjt .jp-box .jp-toggle")).toBeNull();
    expect(container.querySelector(".jp-form")).toBeNull();
    expect(screen.getAllByRole("button", { name: "JSON" })).toHaveLength(2);
  });

  it("a JsonHighlight inside a caller-supplied jsonView follows the toggle, with no second switch", async () => {
    window.localStorage.setItem("ai-demo.json.view", "json");
    const { container } = render(
      <FormJsonToggle value={VALUE} ariaLabel="Response view" jsonView={<pre><JsonHighlight value={VALUE} /></pre>} />,
    );
    expect(container.querySelector(".fjt .jp-raw")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "JSON" })).toHaveLength(1);
  });

  // The callers that already render the payload pass their own JSON node so the
  // JSON view stays exactly what they showed before the toggle existed.
  it("uses a caller-supplied JSON view instead of its own", async () => {
    render(
      <FormJsonToggle
        value={VALUE}
        ariaLabel="Response view"
        defaultView="json"
        jsonView={<pre>200 OK raw</pre>}
      >
        <div>caller form</div>
      </FormJsonToggle>,
    );
    expect(screen.getByText("200 OK raw")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Form" }));
    expect(screen.getByText("caller form")).toBeVisible();
    expect(screen.queryByText("200 OK raw")).toBeNull();
  });
});
