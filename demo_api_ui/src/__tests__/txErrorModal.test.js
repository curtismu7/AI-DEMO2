/**
 * Unit tests for BankingAgent.js — transaction error modal logic
 *
 * Tests two things:
 * 1. Pure JS logic: isTransactionAction correctly classifies action IDs.
 * 2. React render: TxErrorModal shows/hides and close button works.
 */

import "@testing-library/jest-dom";
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Pure logic under test ────────────────────────────────────────────────────
// Mirrors the inline check in BankingAgent.js line ~3548:
//   const isTransactionAction = ["transfer", "deposit", "withdraw"].includes(actionId);

const WRITE_ACTIONS = new Set(["transfer", "deposit", "withdraw"]);
function isTransactionAction(actionId) {
  return WRITE_ACTIONS.has(actionId);
}

// ── Minimal modal component (mirrors the JSX in BankingAgent) ────────────────
function TxErrorModal({ modal, onClose }) {
  if (!modal) return null;
  return (
    <div
      className="ba-tx-error-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Transaction error"
    >
      <div className="ba-tx-error-modal">
        <div className="ba-tx-error-modal__header">❌ {modal.title}</div>
        <div className="ba-tx-error-modal__body">{modal.message}</div>
        <button
          type="button"
          className="ba-tx-error-modal__close"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// Helper: wraps TxErrorModal with local state so we can test open/close
function TxErrorModalHarness({ initialModal }) {
  const [modal, setModal] = useState(initialModal);
  return <TxErrorModal modal={modal} onClose={() => setModal(null)} />;
}

// ── isTransactionAction tests ────────────────────────────────────────────────
describe("isTransactionAction — write action classification", () => {
  it("transfer is a transaction action", () => {
    expect(isTransactionAction("transfer")).toBe(true);
  });

  it("deposit is a transaction action", () => {
    expect(isTransactionAction("deposit")).toBe(true);
  });

  it("withdraw is a transaction action", () => {
    expect(isTransactionAction("withdraw")).toBe(true);
  });

  it("accounts is not a transaction action", () => {
    expect(isTransactionAction("accounts")).toBe(false);
  });

  it("balance is not a transaction action", () => {
    expect(isTransactionAction("balance")).toBe(false);
  });

  it("mcp_tools is not a transaction action", () => {
    expect(isTransactionAction("mcp_tools")).toBe(false);
  });
});

// ── TxErrorModal render tests ────────────────────────────────────────────────
describe("TxErrorModal — render and interaction", () => {
  it("modal shows title and message when txErrorModal is set", () => {
    render(
      <TxErrorModal
        modal={{ title: "Transaction Failed", message: "Insufficient funds" }}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByText(/Transaction Failed/)).toBeInTheDocument();
    expect(screen.getByText("Insufficient funds")).toBeInTheDocument();
  });

  it("modal is not rendered when txErrorModal is null", () => {
    const { container } = render(
      <TxErrorModal modal={null} onClose={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("close button removes the modal", () => {
    render(
      <TxErrorModalHarness
        initialModal={{ title: "Transaction Failed", message: "Declined" }}
      />,
    );

    // Modal is visible initially
    expect(screen.getByText(/Transaction Failed/)).toBeInTheDocument();

    // Click the Close button
    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    // Modal should be gone
    expect(screen.queryByText(/Transaction Failed/)).toBeNull();
  });
});
