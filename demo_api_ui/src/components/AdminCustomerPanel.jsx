import React, { useState, useEffect, useRef, useCallback } from "react";
import bffAxios from "../services/bffAxios";
import { adminCustomerContext } from "../services/adminCustomerContext";
import { KvList } from "./pingUi";
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

// What each action is called in the status line, and what it says when it finishes.
const RUN_LABEL = {
  profile: "profile",
  accounts: "accounts",
  transactions: "transactions",
  reset: "password reset",
  "adjust-accounts": "accounts for the adjustment",
  adjust: "balance adjustment",
};

function doneMessage(kind, data) {
  switch (kind) {
    case "profile": return "Profile loaded.";
    case "accounts": return `Accounts loaded (${Array.isArray(data) ? data.length : 0}).`;
    case "transactions": return `Transactions loaded (${Array.isArray(data) ? data.length : 0}).`;
    case "reset": return "Password reset flagged.";
    case "adjust-accounts": return "Adjust balance form ready.";
    case "adjust": return "Balance adjusted.";
    default: return "Done.";
  }
}

// primaryAction: whether this panel holds the page's one primary button (Dashboard turns it off while its own
// Retry card is the primary). Inside the panel the primary is "View Profile", or "Apply adjustment" while the
// adjust form is open; every other action is a secondary.
const AdminCustomerPanel = ({ primaryAction = true }) => {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const [selectedCustomer, setSelectedCustomer] = useState(null); // { id, name }

  const [actionLoading, setActionLoading] = useState(null); // which action is running
  const [actionError, setActionError] = useState(null);
  const [result, setResult] = useState(null); // { kind, data }

  // Consolidated read. The dashboard used to carry a second "Customer lookup"
  // card with its own search box; its distinguishing value was the PingOne
  // record, which /api/admin/agent does not return. That card is gone and its
  // read path lives here, so there is one search on the page instead of two.
  const [lookup, setLookup] = useState(null);   // { user, accounts, transactions, pingOne }
  const [lookupError, setLookupError] = useState(null);
  const [hints, setHints] = useState([]);

  // Adjust-balance sub-form state
  const [adjustAccountId, setAdjustAccountId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");

  // One status line for the running action. It is mounted from the first render, so its text changing is
  // announced; the buttons keep their names while it runs (aria-disabled shows the busy state).
  const [runStatus, setRunStatus] = useState("");
  const searchRef = useRef(null);
  const selectedRef = useRef(null);
  const resultsRef = useRef(null);
  const pendingFocusRef = useRef(null);

  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);
  const lookupReqRef = useRef(0);

  // Selecting a match unmounts the list the keyboard user was in, and Clear unmounts its own button. Hand focus
  // to the "Acting on" block (which reads the selection) or back to the search box, never to <body>.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    (target === "selected" ? selectedRef.current : searchRef.current)?.focus();
  }, [selectedCustomer]);

  // Apply adjustment replaces the form with its result, so the button that was pressed is gone.
  useEffect(() => {
    if (result && (!document.activeElement || document.activeElement === document.body)) {
      resultsRef.current?.focus();
    }
  }, [result]);

  // Username hint chips — carried over from the dashboard's lookup card.
  useEffect(() => {
    let live = true;
    bffAxios
      .get("/api/admin/users/hints")
      .then(({ data }) => {
        if (live) setHints(Array.isArray(data?.users) ? data.users.slice(0, 6) : []);
      })
      .catch(() => { if (live) setHints([]); });
    return () => { live = false; };
  }, []);

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
    const customer = { id: u.id, name: displayName(u) };
    pendingFocusRef.current = "selected";
    setSelectedCustomer(customer);
    adminCustomerContext.set(customer);
    setResult(null);
    setRunStatus("");
    setActionError(null);
    setAdjustAccountId("");
    setAdjustAmount("");
    setMatches([]);
    setQuery("");

    // Pull the full record for this customer. /api/admin/transactions/lookup is
    // the only path that returns the PingOne record alongside accounts and
    // transactions, which is why it stays the read path while the write
    // operations below continue to use /api/admin/agent.
    const myReq = ++lookupReqRef.current;
    setLookup(null);
    setLookupError(null);
    bffAxios
      .post("/api/admin/transactions/lookup", { username: u.username || customer.name })
      .then(({ data }) => {
        if (myReq !== lookupReqRef.current) return;   // superseded by a newer select
        setLookup(data || null);
      })
      .catch((err) => {
        if (myReq !== lookupReqRef.current) return;
        setLookupError(errMessage(err, "Lookup failed"));
      });
  }, []);

  const handleClear = useCallback(() => {
    pendingFocusRef.current = "search";
    setSelectedCustomer(null);
    setRunStatus("");
    adminCustomerContext.set(null);
    lookupReqRef.current += 1;   // drop any in-flight read for the old customer
    setLookup(null);
    setLookupError(null);
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
      // A result from an earlier action must not sit beside this action's loading or error. The adjust form
      // stays up while it submits so a rejected amount can be corrected.
      if (kind !== "adjust") setResult(null);
      setRunStatus(`Running ${RUN_LABEL[kind] || kind}…`);
      try {
        const data = await fn();
        setResult({ kind, data });
        setRunStatus(doneMessage(kind, data));
      } catch (err) {
        setActionError(errMessage(err, "Action failed"));
        setRunStatus("");
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
  const adjusting = result?.kind === "adjust-accounts";
  const profilePrimary = primaryAction && !adjusting;
  // aria-disabled, not disabled: the button that was just pressed keeps keyboard focus while its action runs.
  // The click is ignored here, and the visible reason is the "Search and select a customer" line (or "Loading…").
  const actionProps = (run) => ({
    type: "button",
    "aria-disabled": disabled ? "true" : undefined,
    "aria-describedby": selectedCustomer ? undefined : "acp-select-hint",
    onClick: disabled ? undefined : run,
  });

  return (
    <section
      className="dash-shell-card pu-card acp-panel"
      aria-labelledby="acp-heading"
    >
      <h2 id="acp-heading" className="dash-shell-card__title">
        Customer lookup &amp; admin
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
          ref={searchRef}
        />
        {hints.length > 0 && !selectedCustomer && (
          <div className="acp-hints" role="group" aria-label="Suggested customers">
            {hints.map((h) => (
              <button
                key={h.username || h}
                type="button"
                className="acp-hint-chip"
                onClick={() => setQuery(h.username || h)}
              >
                {h.username || h}
              </button>
            ))}
          </div>
        )}
        {searching && <span className="acp-hint">Searching…</span>}
        <span role="alert">
          {searchError && <span className="acp-error">❌ {searchError}</span>}
        </span>
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
        <div
          className="acp-selected"
          ref={selectedRef}
          tabIndex={-1}
          aria-label={`Acting on ${selectedCustomer.name}`}
        >
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
        <p id="acp-select-hint" className="acp-hint acp-hint--select">
          Search and select a customer above to enable admin actions.
        </p>
      )}

      {/* Consolidated read — replaces the dashboard's separate lookup card. */}
      <div role="alert">
        {selectedCustomer && lookupError && (
          <p className="acp-error">❌ {lookupError}</p>
        )}
      </div>
      {selectedCustomer && lookup && (
        <div className="acp-lookup">
          <h3 className="acp-lookup__h">Customer profile</h3>
          <ProfileResult user={lookup.user} />

          {lookup.pingOne && (
            <>
              <h3 className="acp-lookup__h">PingOne record</h3>
              {lookup.pingOne.linked === false && (
                <p className="acp-hint">
                  No PingOne record is linked to this customer ({String(lookup.pingOne.reason || "not found")}), so
                  the profile above comes from the demo store only.
                </p>
              )}
              <KvList
                items={Object.entries(lookup.pingOne)
                  .filter(([, v]) => v !== null && typeof v !== "object")
                  .map(([k, v]) => ({ label: k, value: String(v) }))}
              />
            </>
          )}

          <h3 className="acp-lookup__h">Accounts</h3>
          <AccountsTable accounts={lookup.accounts || []} />

          <h3 className="acp-lookup__h">Recent transactions</h3>
          <TransactionsTable transactions={lookup.transactions || []} />
        </div>
      )}

      {/* Action buttons */}
      <div className="acp-actions" role="group" aria-label="Customer admin actions">
        <button
          className={`pu-btn acp-action-btn${profilePrimary ? " pu-btn--primary" : ""}`}
          {...actionProps(viewProfile)}
        >
          View Profile
        </button>
        <button
          className="pu-btn acp-action-btn"
          {...actionProps(viewAccounts)}
        >
          View Accounts
        </button>
        <button
          className="pu-btn acp-action-btn"
          {...actionProps(viewTransactions)}
        >
          View Transactions
        </button>
        <button
          className="pu-btn acp-action-btn"
          {...actionProps(resetPassword)}
        >
          Reset Password
        </button>
        <button
          className="pu-btn acp-action-btn"
          {...actionProps(loadAccountsForAdjust)}
        >
          Adjust Balance
        </button>
      </div>

      <p role="status" className="acp-run-status">{runStatus}</p>

      <div role="alert">
        {actionError && (
          <div className="acp-error acp-error--block">❌ {actionError}</div>
        )}
      </div>

      {/* Results area */}
      {result && (
        <div
          className="acp-results"
          ref={resultsRef}
          tabIndex={-1}
          role="region"
          aria-label="Customer action result"
        >
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
              primary={primaryAction}
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
      <KvList
        items={entries.map(([k, v]) => ({
          label: k,
          value: v === null || v === "" ? "—" : String(v),
        }))}
      />
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
  primary,
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
          className={`pu-btn acp-action-btn${primary ? " pu-btn--primary" : ""}`}
          onClick={submitting || !accountId || amount === "" ? undefined : onSubmit}
          aria-disabled={submitting || !accountId || amount === "" ? "true" : undefined}
        >
          Apply adjustment
        </button>
      </div>
    </div>
  );
}

export default AdminCustomerPanel;
