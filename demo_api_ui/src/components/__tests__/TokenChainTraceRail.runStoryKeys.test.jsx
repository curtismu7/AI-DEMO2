import { render, screen } from "@testing-library/react";
import TokenChainTraceRail from "../TokenChainTraceRail";

// Two bullets that are identical for their first 48 characters. Keying the list
// by `b.slice(0, 48)` collided these and React dropped one sibling; keying by
// index keeps both. This guards that regression against the real component's map.
const PREFIX = "The gateway re-validated the audience, scope and act chain before the "; // > 48 chars
const BIT_A = `${PREFIX}accounts call`;
const BIT_B = `${PREFIX}transfer call`;

// Force a run story with two colliding bits; keep every other export real so the
// rest of the component behaves normally.
vi.mock("../../services/tokenChainTrace/buildTraceSteps", async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    buildRunStory: () => ({ headline: "Test run", outcome: "ok", bits: [BIT_A, BIT_B] }),
  };
});

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({ clearEvents: vi.fn() }),
}));
vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../ClaimDetailsModal", () => ({ default: () => null }));
vi.mock("../TokenLegendModal", () => ({ default: () => null }));

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
});

test("run-story bullets sharing a 48-char prefix both render (keyed by index)", () => {
  // Sanity: the two bits are indistinguishable for the first 48 chars, so a
  // slice(0,48) key would have collided them.
  expect(BIT_A.slice(0, 48)).toBe(BIT_B.slice(0, 48));

  render(<TokenChainTraceRail />);

  const list = document.querySelector(".tctr-story-bits");
  expect(list).not.toBeNull();
  expect(list.querySelectorAll("li")).toHaveLength(2);
  expect(screen.getByText(BIT_A)).toBeInTheDocument();
  expect(screen.getByText(BIT_B)).toBeInTheDocument();
});
