import React from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";

/** Format a number as USD currency — $1,234.56 */
const fmt = (n) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "$0.00";

/**
 * The customer dashboard's banking body (hero, accounts, transfer / deposit / withdraw forms, recent activity).
 * Moved out of UserDashboardPing2026.js unchanged so that file holds the Ping UI frame only; every value it reads
 * is passed in as a prop.
 */
export default function DashboardBankingMain({
  accounts,
  accountsAnchorRef,
  busyAction,
  dashboardLayout,
  depositAccount,
  depositForm,
  expandedAccounts,
  handleDeposit,
  handleScrollToAccounts,
  handleScrollToAssistant,
  handleTransfer,
  handleWithdraw,
  isDemoMode,
  isTransactionNegative,
  recentTxGroups,
  replayNotice,
  selectedAccount,
  setDepositAccount,
  setDepositForm,
  setSelectedAccount,
  setTransferForm,
  setWithdrawAccount,
  setWithdrawForm,
  toggleAccountProfile,
  totalBalance,
  totalDebt,
  transactions,
  transferForm,
  user,
  withdrawAccount,
  withdrawForm,
}) {
  return (
    <>
      {/* Hero: balance, AI insight, lightweight viz (2026 “financial butler” pattern) */}
      <div className="section ud-hero" aria-labelledby="ud-hero-heading">
        <div className="ud-hero__top">
          <p className="ud-hero__eyebrow" id="ud-hero-heading">
            {format(new Date(), "EEEE, MMM d")}
          </p>
          <p className="ud-hero__greet">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, <em>{user?.firstName || "there"}</em>
          </p>
          <p className="ud-hero__insight" role="status">
            {isDemoMode
              ? "Demo snapshot — connect real accounts to unlock personalized cash-flow and savings nudges from the assistant."
              : dashboardLayout === "split3"
                ? "Your balances update automatically. Ask the assistant in the center column for transfers, explanations, or spending patterns."
                : "Your balances update automatically. Ask the assistant below for transfers, explanations, or spending patterns."}
          </p>
        </div>

        <div className="ud-hero__balance-band">
          <div className="ud-balance-main">
            <p className="ud-hero__balance-label">Total Balance</p>
            <p className="ud-hero__balance" aria-live="polite">
              {fmt(totalBalance)}
            </p>
          </div>
          <div
            className="ud-hero__spark"
            aria-hidden="true"
            title="Illustrative activity trend"
          >
            <span style={{ height: "40%" }} />
            <span style={{ height: "65%" }} />
            <span style={{ height: "55%" }} />
            <span style={{ height: "78%" }} />
            <span style={{ height: "62%" }} />
            <span style={{ height: "88%" }} />
            <span style={{ height: "72%" }} />
          </div>
        </div>

        {/* Stats row: quick metrics */}
        <div className="ud-hero__stats">
          <div className="ud-stat">
            <div className="ud-stat__label">Accounts</div>
            <div className="ud-stat__value">{accounts.length}</div>
          </div>
          <div className="ud-stat">
            <div className="ud-stat__label">Available</div>
            <div className="ud-stat__value">{fmt(totalBalance)}</div>
          </div>
          {totalDebt > 0 && (
            <div className="ud-stat">
              <div className="ud-stat__label">Loans</div>
              <div className="ud-stat__value">{fmt(totalDebt)}</div>
            </div>
          )}
          <div className="ud-stat">
            <div className="ud-stat__label">Active</div>
            <div className="ud-stat__value">{accounts.filter((a) => !a.closed).length}</div>
          </div>
        </div>
      </div>

      {/* Proactive actions — reduce menu depth (mobile-first tap targets) */}
      <div className="section ud-quick-actions" aria-label="Quick actions">
        <h2 className="ud-quick-actions__title">Quick actions</h2>
        <div className="ud-quick-actions__row">
          <button
            type="button"
            className="ud-qa-btn"
            onClick={() =>
              user ? handleScrollToAccounts() : navigateToCustomerOAuthLogin()
            }
          >
            Move money
          </button>
          <button
            type="button"
            className="ud-qa-btn"
            onClick={() =>
              user ? handleScrollToAccounts() : navigateToCustomerOAuthLogin()
            }
          >
            Add funds
          </button>
          <button
            type="button"
            className="ud-qa-btn ud-qa-btn--accent"
            onClick={() =>
              user ? handleScrollToAssistant() : navigateToCustomerOAuthLogin()
            }
          >
            Ask assistant
          </button>
          <button
            type="button"
            className="ud-qa-btn ud-qa-btn--delegate"
            onClick={() =>
              window.open(
                "/delegated-access",
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            Manage Delegates
          </button>
        </div>

        {/* Trust + omnichannel / super-app cues (copy only in this demo) */}
        <div className="ud-trust-strip" aria-live="polite">
          <span className="ud-trust-strip__item">Session secured (OAuth)</span>
          <span className="ud-trust-strip__dot" aria-hidden="true" />
          <span className="ud-trust-strip__item">
            Step-up when risk warrants
          </span>
          <span className="ud-trust-strip__dot" aria-hidden="true" />
          <span className="ud-trust-strip__item">
            Biometrics on supported devices
          </span>
          <span className="ud-trust-strip__dot" aria-hidden="true" />
          <a
            href="/api/auth/debug?deep=1"
            target="_blank"
            rel="noopener noreferrer"
            className="ud-trust-strip__item ud-trust-strip__item--debug"
            title="Inspect session and Upstash store health"
          >
            Session debug
          </a>
        </div>
        <nav className="ud-super-pills" aria-label="Quick links">
          <Link
            to="/security"
            className="ud-super-pill"
            aria-label="Security and Insights"
          >
            Insights
          </Link>
          <Link
            to="/transactions"
            className="ud-super-pill"
            aria-label="Payments and Transfers"
          >
            Payments hub
          </Link>
          <Link
            to="/pingone-test"
            className="ud-super-pill"
            aria-label="PingOne integration test page"
          >
            PingOne Test
          </Link>
          <Link
            to="/mfa-test"
            className="ud-super-pill"
            aria-label="MFA test page"
          >
            MFA Test
          </Link>
          <Link
            to="/learning"
            className="ud-super-pill"
            aria-label="Learning Hub"
          >
            Learning Hub
          </Link>
          <Link
            to="/code-search"
            className="ud-super-pill"
            aria-label="RAG code search"
          >
            Code Search
          </Link>
        </nav>
      </div>

      {/* Customer Profile */}
      <div className="section ud-profile-card">
        <div className="ud-profile-header">
          <h2>Account Holder</h2>
          {isDemoMode && <span className="account-demo-badge">Demo mode</span>}
        </div>
        <div className="ud-profile-meta">
          <div className="account-detail-row">
            <span className="detail-label">Name</span>
            <span className="detail-value">
              {user?.firstName || user?.lastName
                ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                : user?.name || user?.username || "—"}
            </span>
          </div>
          <div className="account-detail-row">
            <span className="detail-label">Email</span>
            <span className="detail-value">
              {user?.email || user?.username || "—"}
            </span>
          </div>
          <div className="account-detail-row">
            <span className="detail-label">Role</span>
            <span
              className="detail-value"
              style={{ textTransform: "capitalize" }}
            >
              {user?.role || (isDemoMode ? "demo" : "customer")}
            </span>
          </div>
        </div>
      </div>

      {/* Account Summary */}
      <div ref={accountsAnchorRef} className="section">
        <h2 className="ud-accounts-heading">Your Accounts</h2>
        {/* Lives here rather than inside the transfer form: a successful submit
            clears selectedAccount and unmounts that form, so a notice rendered
            inside it would vanish in the same tick it was set. */}
        {replayNotice && (
          <p
            className="demo-notice udp-demo-notice"
            data-testid="idempotency-replay-notice"
          >
            ✅ {replayNotice}
          </p>
        )}
        {isDemoMode && (
          <p
            className="demo-notice udp-demo-notice"
          >
            Demo mode —{" "}
            <button
              type="button"
              onClick={navigateToCustomerOAuthLogin}
              className="udp-link-btn"
            >
              sign in
            </button>{" "}
            to use your real accounts
          </p>
        )}
        <div className="accounts-grid">
          {accounts.map((account) => {
            const isExpanded = expandedAccounts.has(account.id);
            const acctType = (
              account.accountType ||
              account.type ||
              "unknown"
            ).toLowerCase();
            const isNegative = (account.balance ?? 0) < 0;
            const maskedNum = account.accountNumber
              ? `${acctType.toUpperCase().slice(0, 3)} •••• ${String(account.accountNumber).slice(-4)}`
              : "—";
            const typeLabelMap = {
              checking: "Checking",
              savings: "Savings",
              loan: "Loan",
              car_loan: "Auto Loan",
              mortgage: "Mortgage",
              credit: "Credit",
              investment: "Investment",
              money_market: "Money Market",
            };
            const typeLabel =
              typeLabelMap[acctType] ||
              acctType.charAt(0).toUpperCase() + acctType.slice(1);

            return (
              <div
                key={account.id}
                className={`account-card account-card--${acctType}`}
                style={account._demo ? { opacity: 0.65 } : {}}
              >
                <div className="account-card__body">
                  <div className="account-header">
                    <div>
                      <h3>{account.name}</h3>
                      <p className="account-number">{maskedNum}</p>
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span className={`account-type-badge ${acctType}`}>
                        {typeLabel}
                      </span>
                      {account._demo && (
                        <span className="account-demo-badge">demo</span>
                      )}
                    </div>
                  </div>

                  <div className="account-balance-row">
                    <p
                      className={`balance${isNegative ? " balance--negative" : ""}`}
                    >
                      {fmt(account.balance)}
                    </p>
                    <span className="balance-label">
                      {isNegative ? "Outstanding" : "Available"}
                    </span>
                  </div>

                  <div className="account-actions">
                    <button
                      type="button"
                      className="select-account-btn"
                      onClick={() =>
                        user
                          ? setSelectedAccount(account)
                          : navigateToCustomerOAuthLogin()
                      }
                    >
                      Transfer
                    </button>
                    <button
                      type="button"
                      className="deposit-btn"
                      onClick={() =>
                        user
                          ? setDepositAccount(account)
                          : navigateToCustomerOAuthLogin()
                      }
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      className="withdraw-btn"
                      onClick={() =>
                        user
                          ? setWithdrawAccount(account)
                          : navigateToCustomerOAuthLogin()
                      }
                    >
                      Withdraw
                    </button>
                  </div>
                </div>

                {/* Account Details accordion — always visible */}
                <div className="account-details-section">
                  <button
                    type="button"
                    className={`account-profile-toggle${isExpanded ? " open" : ""}`}
                    onClick={() => toggleAccountProfile(account.id)}
                  >
                    Account Details
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="4 6 8 10 12 6" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="account-profile-details">
                      <div className="account-detail-row">
                        <span className="detail-label">Account Number</span>
                        <span className="detail-value">
                          {account.accountNumber}
                        </span>
                      </div>
                      <div className="account-detail-row">
                        <span className="detail-label">Account Type</span>
                        <span className="detail-value">{typeLabel}</span>
                      </div>
                      {account.routingNumber && (
                        <div className="account-detail-row">
                          <span className="detail-label">Routing Number</span>
                          <span className="detail-value">
                            {account.routingNumber}
                          </span>
                        </div>
                      )}
                      {account.swiftCode && (
                        <div className="account-detail-row">
                          <span className="detail-label">SWIFT</span>
                          <span className="detail-value">
                            {account.swiftCode}
                          </span>
                        </div>
                      )}
                      {account.iban && (
                        <div className="account-detail-row">
                          <span className="detail-label">IBAN</span>
                          <span className="detail-value">{account.iban}</span>
                        </div>
                      )}
                      {account.branchName && (
                        <div className="account-detail-row">
                          <span className="detail-label">Branch</span>
                          <span className="detail-value">
                            {account.branchName}
                          </span>
                        </div>
                      )}
                      {account.openedDate && (
                        <div className="account-detail-row">
                          <span className="detail-label">Opened</span>
                          <span className="detail-value">
                            {new Date(account.openedDate).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                      {account.accountHolderName && (
                        <div className="account-detail-row">
                          <span className="detail-label">Account Holder</span>
                          <span className="detail-value">
                            {account.accountHolderName}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Transfer Form */}
      {selectedAccount && (
        <div className="section">
          <h2>Transfer Money</h2>
          <div className="transfer-form">
            <p>
              From: {selectedAccount.accountType} -{" "}
              {selectedAccount.accountNumber} ({fmt(selectedAccount.balance)})
            </p>
            <form onSubmit={handleTransfer} aria-label="Transfer form">
              <div className="form-group">
                <label>To Account:</label>
                <select
                  value={transferForm.toAccountId}
                  onChange={(e) =>
                    setTransferForm({
                      ...transferForm,
                      toAccountId: e.target.value,
                    })
                  }
                  required
                >
                  <option value="">Select destination account</option>
                  {accounts
                    .filter((account) => account.id !== selectedAccount.id)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.accountType} - {account.accountNumber} (
                        {fmt(account.balance)})
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-group">
                <label>Amount:</label>
                <input
                  type="number"
                  step="0.01"
                  value={transferForm.amount}
                  onChange={(e) =>
                    setTransferForm({ ...transferForm, amount: e.target.value })
                  }
                  placeholder="Enter amount"
                  required
                />
              </div>
              <div className="form-group">
                <label>Description:</label>
                <input
                  type="text"
                  value={transferForm.description}
                  onChange={(e) =>
                    setTransferForm({
                      ...transferForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="Transfer description"
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="transfer-btn"
                  disabled={!user || busyAction === "transfer"}
                  title={!user ? "Sign in to transfer funds" : undefined}
                >
                  {busyAction === "transfer" ? "Transferring…" : "Transfer"}
                </button>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setSelectedAccount(null);
                    setTransferForm({
                      toAccountId: "",
                      amount: "",
                      description: "",
                    });
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deposit Form */}
      {depositAccount && (
        <div className="section">
          <h2>Deposit Money</h2>
          <div className="deposit-form">
            <p>
              To: {depositAccount.accountType} - {depositAccount.accountNumber}{" "}
              ({fmt(depositAccount.balance)})
            </p>
            <form onSubmit={handleDeposit}>
              <div className="form-group">
                <label>Amount:</label>
                <input
                  type="number"
                  step="0.01"
                  value={depositForm.amount}
                  onChange={(e) =>
                    setDepositForm({ ...depositForm, amount: e.target.value })
                  }
                  placeholder="Enter amount"
                  required
                />
              </div>
              <div className="form-group">
                <label>Description:</label>
                <input
                  type="text"
                  value={depositForm.description}
                  onChange={(e) =>
                    setDepositForm({
                      ...depositForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="Deposit description"
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="deposit-submit-btn"
                  disabled={!user || busyAction === "deposit"}
                  title={!user ? "Sign in to deposit funds" : undefined}
                >
                  {busyAction === "deposit" ? "Depositing…" : "Deposit"}
                </button>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setDepositAccount(null);
                    setDepositForm({ amount: "", description: "" });
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Withdraw Form */}
      {withdrawAccount && (
        <div className="section">
          <h2>Withdraw Money</h2>
          <div className="withdraw-form">
            <p>
              From: {withdrawAccount.accountType} -{" "}
              {withdrawAccount.accountNumber} ({fmt(withdrawAccount.balance)})
            </p>
            <form onSubmit={handleWithdraw}>
              <div className="form-group">
                <label>Amount:</label>
                <input
                  type="number"
                  step="0.01"
                  value={withdrawForm.amount}
                  onChange={(e) =>
                    setWithdrawForm({ ...withdrawForm, amount: e.target.value })
                  }
                  placeholder="Enter amount"
                  required
                />
              </div>
              <div className="form-group">
                <label>Description:</label>
                <input
                  type="text"
                  value={withdrawForm.description}
                  onChange={(e) =>
                    setWithdrawForm({
                      ...withdrawForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="Withdrawal description"
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="withdraw-submit-btn"
                  disabled={!user || busyAction === "withdrawal"}
                  title={!user ? "Sign in to withdraw funds" : undefined}
                >
                  {busyAction === "withdrawal" ? "Withdrawing…" : "Withdraw"}
                </button>
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setWithdrawAccount(null);
                    setWithdrawForm({ amount: "", description: "" });
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recent Transactions — hidden if empty */}
      {transactions.length > 0 && (
      <div className="section">
        <h2>Recent Transactions</h2>
        {isDemoMode && (
          <p
            className="demo-notice udp-demo-notice"
          >
            Demo mode —{" "}
            <button
              type="button"
              onClick={navigateToCustomerOAuthLogin}
              className="udp-link-btn"
            >
              sign in
            </button>{" "}
            to see your real transactions
          </p>
        )}
        {(() => {
          const txGroups = recentTxGroups;

          if (txGroups.length === 0) {
            return null;
          }

          // The look of each type is a class in UserDashboardPing2026.pingUi.css (theme tokens), not an inline colour.
          const txTypeStyle = (type) => {
            if (type === "withdrawal") return { kind: "withdrawal", symbol: "↑" };
            if (type === "deposit") return { kind: "deposit", symbol: "↓" };
            if (type === "transfer") return { kind: "transfer", symbol: "⇆" };
            return { kind: "other", symbol: "·" };
          };

          return (
            <div className="tx-feed">
              {txGroups.map((group) => (
                <div key={group.label} className="tx-feed__group">
                  <div className="tx-feed__date-row">
                    <span className="tx-feed__date-label">{group.label}</span>
                    <span className="tx-feed__date-line" />
                  </div>
                  {group.items.map((tx) => {
                    const neg = isTransactionNegative(tx);
                    const ts = txTypeStyle(tx.type);
                    const isAgent = tx.clientType === "ai_agent";
                    return (
                      <div
                        key={tx.id}
                        className="tx-row"
                        style={tx._demo ? { opacity: 0.5 } : {}}
                      >
                        <div className={`tx-row__icon tx-row__icon--${ts.kind}`}>
                          {ts.symbol}
                        </div>
                        <div className="tx-row__body">
                          <div className="tx-row__desc">
                            {tx.description || tx.type}
                          </div>
                          <div className="tx-row__meta">
                            <span className="tx-row__account">
                              {tx.accountInfo || "Unknown"}
                            </span>
                            <span className="tx-row__sep">·</span>
                            <span className="tx-row__time">
                              {format(new Date(tx.createdAt), "HH:mm")}
                            </span>
                            {tx.performedBy && tx.performedBy !== "Unknown" && (
                              <>
                                <span className="tx-row__sep">·</span>
                                <span className="tx-row__time">
                                  {tx.performedBy}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="tx-row__right">
                          <div
                            className={`tx-row__amount ${neg ? "tx-row__amount--neg" : "tx-row__amount--pos"}`}
                          >
                            {neg ? "−" : "+"}
                            {fmt(tx.amount)}
                          </div>
                          {isAgent && (
                            <div className="tx-row__badges">
                              <span className="tx-badge tx-badge--agent">
                                AI
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      )}
    </>
  );
}
