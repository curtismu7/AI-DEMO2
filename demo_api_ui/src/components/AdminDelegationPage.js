import React, { useState, useEffect, useCallback } from "react";

const VALID_SCOPES = [
  { key: "view_accounts", label: "View Accounts" },
  { key: "view_balances", label: "View Balances" },
  { key: "create_deposit", label: "Make Deposits" },
  { key: "create_withdrawal", label: "Make Withdrawals" },
  { key: "create_transfer", label: "Transfer Funds" },
];

const STATUS_OPTIONS = [
  ["active", "Active"],
  ["revoked", "Revoked"],
  ["all", "All"],
];

export default function AdminDelegationPage() {
  const [delegations, setDelegations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [revoking, setRevoking] = useState(null);
  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");

  // Grant form
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantDelegatorEmail, setGrantDelegatorEmail] = useState("");
  const [grantDelegateEmail, setGrantDelegateEmail] = useState("");
  const [grantScopes, setGrantScopes] = useState([
    "view_accounts",
    "view_balances",
  ]);
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setPageError("");
    try {
      const qs = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/delegation/admin/all${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDelegations(data.delegations || []);
    } catch (err) {
      setPageError("Failed to load delegations: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRevoke = async (id) => {
    setRevoking(id);
    setPageError("");
    try {
      const res = await fetch(`/api/delegation/admin/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.ok) {
        setPageError("Revoke failed: " + (data.message || data.error));
      } else {
        setPageSuccess("Delegation revoked.");
        await load();
        setTimeout(() => setPageSuccess(""), 3000);
      }
    } catch (err) {
      setPageError("Revoke error: " + err.message);
    } finally {
      setRevoking(null);
    }
  };

  const handleGrant = async () => {
    if (!grantDelegatorEmail.trim() || !grantDelegateEmail.trim()) {
      setGrantError("Both emails are required.");
      return;
    }
    if (grantScopes.length === 0) {
      setGrantError("Select at least one scope.");
      return;
    }
    setGranting(true);
    setGrantError("");
    try {
      const res = await fetch("/api/delegation/admin/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delegatorEmail: grantDelegatorEmail.trim(),
          delegateEmail: grantDelegateEmail.trim(),
          scopes: grantScopes,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setGrantError(data.message || `Grant failed (${data.error})`);
      } else {
        setPageSuccess(
          `Delegation granted: ${grantDelegatorEmail} → ${grantDelegateEmail}`,
        );
        setGrantDelegatorEmail("");
        setGrantDelegateEmail("");
        setGrantScopes(["view_accounts", "view_balances"]);
        setGrantOpen(false);
        await load();
        setTimeout(() => setPageSuccess(""), 4000);
      }
    } catch (err) {
      setGrantError("Network error: " + err.message);
    } finally {
      setGranting(false);
    }
  };

  const toggleGrantScope = (key) =>
    setGrantScopes((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const filtered = delegations.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (d.delegator_email || "").toLowerCase().includes(q) ||
      (d.delegate_email || "").toLowerCase().includes(q)
    );
  });

  return (
    <div
      style={{
        padding: "24px 28px 48px",
        background: "#f8fafc",
        minHeight: "100vh",
      }}
    >
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#374151",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Admin
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#111827",
              margin: 0,
            }}
          >
            Family Delegation
          </h1>
          <p style={{ fontSize: 13, color: "#374151", margin: "4px 0 0" }}>
            OAuth delegation records across all users
          </p>
        </div>
        <button
          onClick={() => {
            setGrantOpen((o) => !o);
            setGrantError("");
          }}
          style={{
            padding: "8px 18px",
            background: grantOpen ? "#f3f4f6" : "#1e40af",
            color: grantOpen ? "#374151" : "#fff",
            border: grantOpen ? "1px solid #e5e7eb" : "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {grantOpen ? "Cancel" : "Grant Delegation"}
        </button>
      </div>

      {/* Banners */}
      {pageError && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            color: "#991b1b",
            fontSize: 13,
          }}
        >
          {pageError}
        </div>
      )}
      {pageSuccess && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: 6,
            color: "#166534",
            fontSize: 13,
          }}
        >
          {pageSuccess}
        </div>
      )}

      {/* Grant form */}
      {grantOpen && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#111827",
              margin: "0 0 16px",
            }}
          >
            New Delegation
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: 4,
                }}
              >
                Delegator email
              </label>
              <input
                type="email"
                placeholder="owner@example.com"
                value={grantDelegatorEmail}
                onChange={(e) => setGrantDelegatorEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: 4,
                }}
              >
                Delegate email
              </label>
              <input
                type="email"
                placeholder="delegate@example.com"
                value={grantDelegateEmail}
                onChange={(e) => setGrantDelegateEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "#374151",
                marginBottom: 8,
              }}
            >
              Scopes
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {VALID_SCOPES.map((s) => (
                <label
                  key={s.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    cursor: "pointer",
                    color: "#374151",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={grantScopes.includes(s.key)}
                    onChange={() => toggleGrantScope(s.key)}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          {grantError && (
            <div
              style={{
                marginBottom: 12,
                padding: "8px 12px",
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: 6,
                color: "#991b1b",
                fontSize: 13,
              }}
            >
              {grantError}
            </div>
          )}
          <button
            onClick={handleGrant}
            disabled={
              granting ||
              !grantDelegatorEmail.trim() ||
              !grantDelegateEmail.trim() ||
              grantScopes.length === 0
            }
            style={{
              padding: "8px 18px",
              background:
                granting ||
                !grantDelegatorEmail.trim() ||
                !grantDelegateEmail.trim() ||
                grantScopes.length === 0
                  ? "#93c5fd"
                  : "#1e40af",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor:
                granting ||
                !grantDelegatorEmail.trim() ||
                !grantDelegateEmail.trim() ||
                grantScopes.length === 0
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {granting ? "Granting…" : "Grant Access"}
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          {STATUS_OPTIONS.map(([val, label], i) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              style={{
                padding: "7px 14px",
                border: "none",
                borderRight:
                  i < STATUS_OPTIONS.length - 1 ? "1px solid #e5e7eb" : "none",
                background: statusFilter === val ? "#1e40af" : "#fff",
                color: statusFilter === val ? "#fff" : "#6b7280",
                fontSize: 13,
                fontWeight: statusFilter === val ? 700 : 400,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 12px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            fontSize: 13,
            minWidth: 220,
          }}
        />
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: "7px 14px",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            fontSize: 13,
            cursor: loading ? "default" : "pointer",
            color: "#374151",
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        <span style={{ fontSize: 13, color: "#374151", marginLeft: "auto" }}>
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "#374151",
              fontSize: 13,
            }}
          >
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "#374151",
              fontSize: 13,
            }}
          >
            No delegations found.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#f8fafc",
                    borderBottom: "2px solid #e5e7eb",
                  }}
                >
                  {[
                    "Delegator",
                    "Delegate",
                    "Scopes",
                    "Status",
                    "Granted",
                    "Revoked",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "10px 16px",
                        fontWeight: 600,
                        color: "#374151",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((d, i) => (
                  <tr
                    key={d.id}
                    style={{
                      borderBottom:
                        i < filtered.length - 1 ? "1px solid #f3f4f6" : "none",
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 16px",
                        color: "#111827",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.delegator_email || "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        color: "#374151",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.delegate_email || "—"}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
                      >
                        {(d.scopes || []).map((s) => (
                          <span
                            key={s}
                            style={{
                              background: "#eff6ff",
                              color: "#1d4ed8",
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 10,
                            }}
                          >
                            {s.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          padding: "2px 10px",
                          borderRadius: 10,
                          fontSize: 12,
                          fontWeight: 600,
                          background:
                            d.status === "active" ? "#dcfce7" : "#f3f4f6",
                          color: d.status === "active" ? "#15803d" : "#6b7280",
                        }}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        color: "#374151",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.granted_at
                        ? new Date(d.granted_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        color: "#374151",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d.revoked_at
                        ? new Date(d.revoked_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      {d.status === "active" ? (
                        <button
                          onClick={() => handleRevoke(d.id)}
                          disabled={revoking === d.id}
                          style={{
                            padding: "5px 12px",
                            background: "#fee2e2",
                            color: revoking === d.id ? "#fca5a5" : "#dc2626",
                            border: "1px solid #fca5a5",
                            borderRadius: 5,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor:
                              revoking === d.id ? "not-allowed" : "pointer",
                          }}
                        >
                          {revoking === d.id ? "Revoking…" : "Revoke"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: "#d1d5db" }}>
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
