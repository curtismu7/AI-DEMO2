import React, { useState, useEffect, useRef, useCallback } from "react";
import bffAxios from "../services/bffAxios";
import "./AdminCustomerPanel.css";

const API = "/api/admin/agent";

// Build a human display name from the safe user fields returned by /lookup.
function displayName(u) {
  const full = `${u.firstName || ""} ${u.lastName || ""}`.trim();
  return full || u.username || u.email || u.id;
}

function money(n) {
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function errMessage(err, fallback) {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    fallback
  );
}

const AdminCustomerPanel = () => {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const [selectedCustomer, setSelectedCustomer] = useState(null); // { id, name }

  const [actionLoading, setActionLoading] = useState(null); // which action is running
  const [actionError, setActionError] = useState(null);
  const [result, setResult] = useState(null); // { kind, data }

  // Adjust-balance sub-form state
  const [adjustAccountId, setAdjustAccountId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");

  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  // Debounced search (~300ms). q must be >= 1 char.
  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 1) {
      setMatches([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      try {
        const { data } = await bffAxios.get(`${API}/lookup`, { params: { q } });
        if (myReq !== reqIdRef.current) return; // stale
        setMatches(Array.isArray(data.users) ? data.users : []);
        setSearchError(null);
      } catch (err) {
        if (myReq !== reqIdRef.current) return;
        setMatches([]);
        setSearchError(errMessage(err, "Lookup failed"));
      } finally {
        if (myReq === reqIdRef.current) setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = useCallback((u) => {
    setSelectedCustomer({ id: u.id, name: displayName(u) });
    setResult(null);
    setActionError(null);
    setAdjustAccountId("");
    setAdjustAmount("");
    setMatches([]);
    setQuery("");
  }, []);

  const handleClear = useCallback(() => {
    setSelectedCustomer(null);
    setResult(null);
    setActionError(null);
    setAdjustAccountId("");
    setAdjustAmount("");
  }, []);

  const runAction = useCallback(
    async (kind, fn) => {
      if (!selectedCustomer) return;
      setActionLoading(kind);
      setActionError(null);
      try {
        const data = await fn();
        setResult({ kind, data });
      } catch (err) {
        setActionError(errMessage(err, "Action failed"));
      } finally {
        setActionLoading(null);
      }
    },
    [selectedCustomer],
  );

  const viewProfile = () =>
    runAction("profile", async () => {
      const { data } = await bffAxios.get(`${API}/users/${selectedCustomer.id}`);
      return data.user;
    });

  const viewAccounts = () =>
    runAction("accounts", async () => {
      const { data } = await bffAxios.get(
        `${API}/users/${selectedCustomer.id}/accounts`,
      );
      return data.accounts || [];
    });

  const viewTransactions = () =>
    runAction("transactions", async () => {
      const { data } = await bffAxios.get(
        `${API}/users/${selectedCustomer.id}/transactions`,
        { params: { limit: 5 } },
      );
      return data.transactions || [];
    });

  const resetPassword = () =>
    runAction("reset", async () => {
      const { data } = await bffAxios.post(
        `${API}/users/${selectedCustomer.id}/reset-password`,
      );
      return data;
    });

  // Adjust flow: first load accounts so the admin can pick one, then POST.
  const loadAccountsForAdjust = () =>
    runAction("adjust-accounts", async () => {
      const { data } = await bffAxios.get(
        `${API}/users/${selectedCustomer.id}/accounts`,
      );
      return data.accounts || [];
    });

  const submitAdjust = () =>
    runAction("adjust", async () => {
      const amount = parseFloat(adjustAmount);
      if (!adjustAccountId) throw new Error("Select an account to adjust");
      if (!isFinite(amount)) throw new Error("Enter a valid amount");
      const { data } = await bffAxios.post(
        `${API}/accounts/${adjustAccountId}/adjust`,
        { amount },
      );
      return data;
    });

  const busy = actionLoading !== null;
  const disabled = !selectedCustomer || busy;

  return (
    <section
      className="dash-shell-card acp-panel"
      aria-labelledby="acp-heading"
    >
      <h2 id="acp-heading" className="dash-shell-card__title">
        Customer Admin
      </h2>
      <p className="acp-subtitle">
        Search for a demo customer, select them, then run real admin operations
        directly (deterministic — no AI agent).
      </p>

      {/* Search */}
      <div className="acp-search">
        <label htmlFor="acp-search-input" className="acp-label">
          Search customers
        </label>
        <input
          id="acp-search-input"
          type="text"
          className="form-control acp-search-input"
          placeholder="Name, email, or username"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        {searching && <span className="acp-hint">Searching…</span>}
        {searchError && (
          <span className="acp-error" role="alert">
            ❌ {searchError}
          </span>
        )}
      </div>

      {matches.length > 0 && (
        <ul className="acp-matches" role="listbox" aria-label="Search results">
          {matches.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="acp-match"
                onClick={() => handleSelect(u)}
              >
                <span className="acp-match__name">{displayName(u)}</span>
                <span className="acp-match__meta">
                  {u.email || u.username || u.id}
                  {u.role ? ` · ${u.role}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching &&
        !searchError &&
        query.trim().length >= 1 &&
        matches.length === 0 && (
          <p className="acp-hint">No customers matched "{query.trim()}".</p>
        )}

      {/* Selected customer banner */}
      {selectedCustomer ? (
        <div className="acp-selected" role="status">
          <span className="acp-selected__label">Acting on:</span>
          <span className="acp-selected__name">
            {selectedCustomer.name}{" "}
            <span className="acp-selected__id">({selectedCustomer.id})</span>
          </span>
          <button
            type="button"
            className="acp-clear-btn"
            onClick={handleClear}
            title="Clear selected customer"
          >
            Clear ✕
          </button>
        </div>
      ) : (
        <p className="acp-hint acp-hint--select">
          Search and select a customer above to enable admin actions.
        </p>
      )}

      {/* Action buttons */}
      <div className="acp-actions" role="group" aria-label="Customer admin actions">
        <button
          type="button"
          className="btn btn-primary acp-action-btn"
          disabled={disabled}
          onClick={viewProfile}
        >
          {actionLoading === "profile" ? "Loading…" : "View Profile"}
        </button>
        <button
          type="button"
          className="btn btn-primary acp-action-btn"
          disabled={disabled}
          onClick={viewAccounts}
        >
          {actionLoading === "accounts" ? "Loading…" : "View Accounts"}
        </button>
        <button
          type="button"
          className="btn btn-primary acp-action-btn"
          disabled={disabled}
          onClick={viewTransactions}
        >
          {actionLoading === "transactions" ? "Loading…" : "View Transactions"}
        </button>
        <button
          type="button"
          className="btn btn-primary acp-action-btn"
          disabled={disabled}
          onClick={resetPassword}
        >
          {actionLoading === "reset" ? "Working…" : "Reset Password"}
        </button>
        <button
          type="button"
          className="btn btn-primary acp-action-btn"
          disabled={disabled}
          onClick={loadAccountsForAdjust}
        >
          {actionLoading === "adjust-accounts" ? "Loading…" : "Adjust Balance"}
        </button>
      </div>

      {actionError && (
        <div className="acp-error acp-error--block" role="alert">
          ❌ {actionError}
        </div>
      )}

      {/* Results area */}
      {result && (
        <div className="acp-results">
          {result.kind === "profile" && <ProfileResult user={result.data} />}
          {result.kind === "accounts" && (
            <AccountsTable accounts={result.data} />
          )}
          {result.kind === "transactions" && (
            <TransactionsTable transactions={result.data} />
          )}
          {result.kind === "reset" && (
            <div className="acp-callout acp-callout--ok">
              ✅ Password reset flagged. This customer must set a new password on
              next login.
              <pre className="acp-json">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </div>
          )}
          {result.kind === "adjust" && (
            <div className="acp-callout acp-callout--ok">
              ✅ Balance adjusted. New balance:{" "}
              <strong>{money(result.data.newBalance)}</strong> on account{" "}
              {result.data.accountId}.
            </div>
          )}
          {result.kind === "adjust-accounts" && (
            <AdjustForm
              accounts={result.data}
              accountId={adjustAccountId}
              amount={adjustAmount}
              onAccountChange={setAdjustAccountId}
              onAmountChange={setAdjustAmount}
              onSubmit={submitAdjust}
              submitting={actionLoading === "adjust"}
            />
          )}
        </div>
      )}
    </section>
  );
};

function ProfileResult({ user }) {
  if (!user) return <p className="acp-hint">No profile returned.</p>;
  const entries = Object.entries(user).filter(
    ([, v]) => typeof v !== "object" || v === null,
  );
  return (
    <div>
      <h3 className="acp-result-title">Profile</h3>
      <dl className="acp-dl">
        {entries.map(([k, v]) => (
          <div key={k} className="acp-dl__row">
            <dt className="acp-dl__key">{k}</dt>
            <dd className="acp-dl__val">
              {v === null || v === "" ? "—" : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AccountsTable({ accounts }) {
  if (!accounts || accounts.length === 0)
    return (
      <>
        <h3 className="acp-result-title">Accounts</h3>
        <p className="acp-hint">No accounts on file for this customer.</p>
      </>
    );
  return (
    <div>
      <h3 className="acp-result-title">Accounts ({accounts.length})</h3>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Account #</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name || "—"}</td>
                <td>{a.accountType || "—"}</td>
                <td className="acp-mono">{a.accountNumber || a.id}</td>
                <td>
                  {money(a.balance)} {a.currency || ""}
                </td>
                <td>{a.isActive === false ? "frozen" : a.status || "active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionsTable({ transactions }) {
  if (!transactions || transactions.length === 0)
    return (
      <>
        <h3 className="acp-result-title">Recent transactions</h3>
        <p className="acp-hint">No transactions on file for this customer.</p>
      </>
    );
  return (
    <div>
      <h3 className="acp-result-title">
        Recent transactions ({transactions.length})
      </h3>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td>
                  {tx.createdAt
                    ? new Date(tx.createdAt).toLocaleString()
                    : "—"}
                </td>
                <td>{tx.type || "—"}</td>
                <td>{money(tx.amount)}</td>
                <td>{tx.description || "—"}</td>
                <td>{tx.status || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdjustForm({
  accounts,
  accountId,
  amount,
  onAccountChange,
  onAmountChange,
  onSubmit,
  submitting,
}) {
  if (!accounts || accounts.length === 0)
    return (
      <p className="acp-hint">
        This customer has no accounts to adjust.
      </p>
    );
  return (
    <div className="acp-adjust">
      <h3 className="acp-result-title">Adjust balance</h3>
      <div className="acp-adjust__fields">
        <div>
          <label htmlFor="acp-adjust-account" className="acp-label">
            Account
          </label>
          <select
            id="acp-adjust-account"
            className="form-control acp-select"
            value={accountId}
            onChange={(e) => onAccountChange(e.target.value)}
          >
            <option value="">Select an account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {(a.name || a.accountType || "Account")} ·{" "}
                {a.accountNumber || a.id} · {money(a.balance)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="acp-adjust-amount" className="acp-label">
            Amount (negative to debit)
          </label>
          <input
            id="acp-adjust-amount"
            type="number"
            step="0.01"
            className="form-control acp-select"
            placeholder="e.g. 100 or -50"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary acp-action-btn"
          onClick={onSubmit}
          disabled={submitting || !accountId || amount === ""}
        >
          {submitting ? "Applying…" : "Apply adjustment"}
        </button>
      </div>
    </div>
  );
}

export default AdminCustomerPanel;
