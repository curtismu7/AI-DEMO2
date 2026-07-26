/* eslint-disable testing-library/no-node-access */
/**
 * Regression tests for two UI layout/modal bugs:
 *
 * 1. AgentConsentModal transaction branch must be compact — no KV table,
 *    no high-value-warning, no IntentAuthDecisionDisplay. Details live in a
 *    single subtitle line under the action title (matching hitlContext style).
 *    If this fails, someone re-added verbose fields — keep the modal simple.
 *
 * 2. UserDashboard CSS split3 grid must use minmax(0, 1fr) not bare 1fr.
 *    Plain `1fr` allows a column to grow to its content min-size; a wide
 *    token-chain step card causes the token-chain column to expand and squish
 *    the agent column. minmax(0, 1fr) sets the floor to 0, preventing blowout.
 *    If this fails, someone reverted the grid fix — always use minmax(0, 1fr).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import AgentConsentModal from "../AgentConsentModal";

// ─── AgentConsentModal — transaction branch is compact ────────────────────────

const txTransfer = {
  type: "transfer",
  amount: 750,
  fromAccountId: "CHK-001",
  toAccountId: "SAV-002",
  description: "Transfer funds",
};

function mountModal(props = {}) {
  return render(
    <AgentConsentModal
      transaction={txTransfer}
      onAccept={() => {}}
      onDismiss={() => {}}
      {...props}
    />
  );
}

describe("AgentConsentModal transaction branch — compact (ledger)", () => {
  it("renders the action headline in the card", () => {
    mountModal();
    const card = document.querySelector(".acm-card__title");
    expect(card).not.toBeNull();
    expect(card.textContent).toMatch(/Transfer funds/i);
  });

  it("renders amount + accounts as compact subtitle, not separate KV rows", () => {
    mountModal();
    const subtitle = document.querySelector(".acm-card__subtitle");
    expect(subtitle).not.toBeNull();
    expect(subtitle.textContent).toMatch(/750/);
    expect(subtitle.textContent).toMatch(/CHK-001/);
    expect(subtitle.textContent).toMatch(/SAV-002/);
  });

  it("does NOT render a KV table (.acm-kv)", () => {
    mountModal();
    expect(document.querySelector(".acm-kv")).toBeNull();
  });

  it("does NOT render a high-value-warning block", () => {
    mountModal();
    expect(document.querySelector(".acm-high-value-warning")).toBeNull();
  });

  it("renders the assurances list", () => {
    mountModal();
    expect(
      screen.getByText(/Recorded in the audit trail/i)
    ).toBeInTheDocument();
  });

  it("renders the agree checkbox", () => {
    mountModal();
    expect(document.querySelector(".acm-agree-cb")).not.toBeNull();
  });
});

// ─── UserDashboard CSS — no bare 1fr columns in split3 grid ──────────────────

describe("UserDashboard CSS grid — minmax(0, 1fr) not bare 1fr (ledger)", () => {
  let cssText;

  beforeAll(() => {
    const raw = readFileSync(
      resolve(__dirname, "../UserDashboard.css"),
      "utf8"
    );
    // Strip CSS block comments so the regex doesn't match comment text.
    cssText = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  });

  it("no grid-template-columns rule uses bare 1fr 1fr 1fr", () => {
    const bare = cssText.match(/grid-template-columns:\s*1fr\s+1fr\s+1fr/g);
    expect(bare).toBeNull();
  });

  it("no grid-template-columns rule uses bare 1fr 1fr (multi-column only)", () => {
    // Single `1fr` alone (e.g. mobile stack at 1024px) is fine.
    // Small icon/detail grids (.logo-icon, .ud-logo-grid, .account-profile-details)
    // are also fine — only the ud-body split3 layout columns cause the token-chain
    // blowout. Extract just the ud-body block lines and check those.
    const lines = cssText.split("\n");
    const udBodyLines = lines.filter(
      (l) =>
        l.includes("grid-template-columns") &&
        (l.includes("1fr") || l.includes("minmax"))
    );
    // Filter to lines that are preceded by a ud-body selector — we check via
    // context: lines that sit inside a rule containing "ud-body--dashboard-split3"
    // are the dangerous ones. Simpler: assert none of the col declarations inside
    // a split3 context use bare 1fr 1fr.
    const split3Blocks = cssText.match(
      /ud-body[^{]*dashboard-split3[^}]*grid-template-columns:[^;]+;/gs
    ) || [];
    const bare = split3Blocks.filter((block) =>
      /grid-template-columns:\s*(?:minmax\([^)]+\)\s+)*1fr\s+1fr(?!\s+1fr)(?!\s*minmax)/
        .test(block)
    );
    expect(bare).toHaveLength(0);
  });
});
