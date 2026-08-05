// Presentational result-display components extracted from AIAgent.js.
// All are stateless w.r.t. the BankingAgent component — they render from props only.
// (ResultsPanel keeps its own local resize state, but takes its content via props.)
import React, { useState, useRef, useCallback } from "react";
import { formatCurrency, formatDateTime } from "../utils/formatters";
import { InlineMd, MarkdownContent } from "./shared/MarkdownText";
import VerticalResult from "./VerticalResult";

// ─── Results Panel (side panel showing rich formatted data next to the agent) ──

const _BANKING_TYPES_RE = /^(checking|savings|loan|chequing)$/i;

export function AccountsTable({ accounts, terminology }) {
  if (!accounts?.length)
    return <p className="bar-rp-empty">No accounts found.</p>;

  const verticalTypes = terminology?.accountTypes || [];

  const resolveAccountType = (a, idx) => {
    const raw = a.accountType || a.account_type || a.type || "";
    // Fool-proof: substitute banking type labels when in a non-banking vertical
    if (terminology && verticalTypes.length && _BANKING_TYPES_RE.test(raw)) {
      return verticalTypes[idx] || verticalTypes[0] || terminology.account || "Account";
    }
    return raw || terminology?.account || "Account";
  };

  const getFriendlyAccountName = (account) => {
    if (!account) return terminology?.account || "Account";
    // Use server-stored name for banking vertical (no terminology overlay)
    if (!terminology && account.name && account.name !== account.id) {
      return account.name;
    }
    const accountNumber = account.accountNumber || account.account_number || account.id || "";
    const accountLabel = terminology?.account || "Account";
    return accountNumber ? `${accountLabel} (${accountNumber.slice(-4)})` : accountLabel;
  };

  return (
    <table className="bar-rp-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>{(terminology?.account || "Account")} Name</th>
          <th>{terminology?.balance || "Balance"}</th>
        </tr>
      </thead>
      <tbody>
        {accounts.filter(Boolean).map((a, i) => (
          <tr key={a.account_number || a.id || i}>
            <td>{resolveAccountType(a, i)}</td>
            <td>
              <span className="bar-rp-account-name">
                {getFriendlyAccountName(a)}
              </span>
            </td>
            <td className="bar-rp-amount">{formatCurrency(a.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TransactionsTable({ transactions, terminology }) {
  if (!transactions?.length)
    return <p className="bar-rp-empty">No transactions found.</p>;
  return (
    <table className="bar-rp-table">
      <thead>
        <tr>
          <th>{terminology?.transaction || "Type"}</th>
          <th>{terminology?.balance || "Amount"}</th>
          <th>Description</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        {transactions.slice(0, 20).map((t, i) => (
          <tr key={t.id || i}>
            <td>
              <span
                className={`bar-rp-type bar-rp-type-${(t.type || "").toLowerCase()}`}
              >
                {t.type}
              </span>
            </td>
            <td className="bar-rp-amount">{formatCurrency(t.amount)}</td>
            <td className="bar-rp-desc" title={t.description || ""}>
              {t.description || "—"}
            </td>
            <td className="bar-rp-date">
              {new Date(
                t.date || t.created_at || t.createdAt || Date.now(),
              ).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Renders sequential_think reasoning steps as a collapsible block. */
export function ReasoningSteps({ steps, conclusion }) {
  if (!steps?.length && !conclusion) {
    return (
      <div className="ba-reasoning ba-reasoning--empty">
        <span className="ba-reasoning__icon" aria-hidden>
          [R]
        </span>
        <span
          className="ba-reasoning__label"
          style={{
            color: "var(--color-text-secondary,#6b7280)",
            fontSize: "0.85rem",
            marginLeft: 6,
          }}
        >
          Sequential thinking unavailable (MCP server not connected)
        </span>
      </div>
    );
  }
  return (
    <details className="ba-reasoning" open>
      <summary className="ba-reasoning__summary">
        <span className="ba-reasoning__icon" aria-hidden>
          [R]
        </span>
        <span className="ba-reasoning__label">
          Reasoning ({steps?.length ?? 0} steps)
        </span>
      </summary>
      <div className="ba-reasoning__body">
        <ol className="ba-reasoning__steps">
          {steps.map((step, i) => (
            <li key={i} className="ba-reasoning__step">
              <span className="ba-reasoning__step-title">{step.title}</span>
              {step.description && (
                <p className="ba-reasoning__step-desc">{step.description}</p>
              )}
            </li>
          ))}
        </ol>
        {conclusion && (
          <p className="ba-reasoning__conclusion"> {conclusion}</p>
        )}
      </div>
    </details>
  );
}

/** Renders MCP-style tool step chips (read/update account, transactions) between user ask and reply. */
export function ToolProgressChips({ steps }) {
  const [expandedIdx, setExpandedIdx] = React.useState(null);
  if (!steps?.length) return null;
  return (
    <ul className="ba-tool-progress" aria-label="Tool calls">
      {steps.map((s, i) => {
        const isExpanded = expandedIdx === i;
        const hasError = s.status === "error" && s.error;
        return (
          <li
            key={`${s.name}-${i}`}
            className={`ba-tool-chip${hasError ? " ba-tool-chip--error" : ""}`}
          >
            <div
              className="ba-tool-chip-row"
              onClick={() => hasError && setExpandedIdx(isExpanded ? null : i)}
              style={{ cursor: hasError ? "pointer" : "default" }}
            >
              <span className="ba-tool-chip-ico" aria-hidden />
              <span className="ba-tool-chip-name">{s.name}</span>
              <span className="ba-tool-chip-sep">·</span>
              <span
                className={`ba-tool-chip-status ba-tool-chip-status--${s.status}`}
              >
                {s.status === "running"
                  ? "Running…"
                  : s.status === "success"
                    ? "Success"
                    : "Failed"}
              </span>
              <span className="ba-tool-chip-chev" aria-hidden>
                {hasError ? (isExpanded ? "▾" : "▸") : "›"}
              </span>
            </div>
            {hasError && isExpanded && (
              <div className="ba-tool-chip-detail">
                <div className="ba-tool-chip-detail-row">
                  <span className="ba-tool-chip-detail-label">Tool</span>
                  <code>{s.error.tool || s.name}</code>
                </div>
                {s.error.code && (
                  <div className="ba-tool-chip-detail-row">
                    <span className="ba-tool-chip-detail-label">Code</span>
                    <code>{s.error.code}</code>
                  </div>
                )}
                {s.error.message && (
                  <div className="ba-tool-chip-detail-row">
                    <span className="ba-tool-chip-detail-label">Message</span>
                    <span>{s.error.message}</span>
                  </div>
                )}
                <div className="ba-tool-chip-detail-hint">
                  See the chat response below for full policy explanation and
                  fix hints.
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function parseAirlineBookingsMessage(text) {
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) return null;

  try {
    const payload = JSON.parse(text.slice(jsonStart).trim());
    const passenger = payload?.passenger;
    if (!passenger || !Array.isArray(passenger.bookings)) return null;
    return {
      intro: text.slice(0, jsonStart).trim(),
      passenger,
    };
  } catch {
    return null;
  }
}

function formatAirlineDeparture(value) {
  const localTime = String(value).match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/,
  )?.[1];
  return formatDateTime(localTime ? `${localTime}Z` : value);
}

function AirlineBookingsMessage({ intro, passenger }) {
  const summary = [
    passenger.loyaltyTier,
    passenger.loyaltyPoints != null
      ? `${Number(passenger.loyaltyPoints).toLocaleString()} miles`
      : null,
  ].filter(Boolean);

  return (
    <div className="ba-airline-bookings">
      {intro && <MarkdownContent text={intro} className="ba-msg-body" />}
      <div className="ba-airline-passenger">
        <strong>{passenger.name || "Passenger"}</strong>
        {summary.length > 0 && <span>{summary.join(" · ")}</span>}
      </div>
      <div className="ba-airline-booking-list">
        {passenger.bookings.map((booking, index) => (
          <section
            className="ba-airline-booking"
            key={booking.confirmationNumber || `${booking.flightNumber}-${index}`}
          >
            <div className="ba-airline-booking-header">
              <strong>{booking.flightNumber || "United flight"}</strong>
              {booking.route && <span>{booking.route}</span>}
            </div>
            <dl className="ba-airline-booking-details">
              {[
                ["Confirmation", booking.confirmationNumber],
                ["Departure", booking.departureTime, formatAirlineDeparture],
                ["Gate", booking.gate],
                ["Seat", booking.seat],
                ["Cabin", booking.cabin],
                ["Checked bags", booking.checkedBags],
                ["Booking", booking.status],
                ["Flight", booking.flightStatus],
              ]
                .filter(([, value]) => value !== null && value !== undefined && value !== "")
                .map(([label, value, formatter]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{formatter ? formatter(value) : String(value)}</dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

export function MessageContent({ text, isTokenEvent, terminology }) {
  const airlineBookings = parseAirlineBookingsMessage(text);
  if (airlineBookings) {
    return <AirlineBookingsMessage {...airlineBookings} />;
  }

  // Detect and format account data as tables (remove emojis)
  // Matches lines emitted by formatResult: "Type (****NNNN) — $X.XX USD"
  const accountPattern = /^(.+?)\s*\(([^)]+)\)\s*—\s*(\$[\d,]+\.\d{2}(?:\s+\w+)?)\s*$/gm;
  const accountMatches = [...text.matchAll(accountPattern)];

  if (accountMatches.length > 0) {
    const rows = accountMatches.map((match) => ({
      account: match[1].trim(),
      id: match[2].trim(),
      balance: match[3].trim(),
    }));

    return (
      <table className="ba-msg-table">
        <thead>
          <tr>
            <th>{terminology?.accounts || "Account"}</th>
            <th>ID</th>
            <th>{terminology?.balance || "Balance"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.account}-${idx}`}>
              <td>
                <strong>{row.account}</strong>
              </td>
              <td>{row.id}</td>
              <td>{row.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Detect and format transaction data as tables
  const transactionPattern =
    /^(transfer_out|transfer_in|deposit|withdrawal|balance):\s*(.+?)(?=\n|$)/gm;
  const hasTransactions = transactionPattern.test(text);

  if (hasTransactions) {
    const rows = [];
    const lines = text.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i++;
        continue;
      }

      const match = line.match(
        /^(transfer_out|transfer_in|deposit|withdrawal|balance):\s*(.+)/,
      );
      if (match) {
        const [, type, content] = match;
        const nextLine = lines[i + 1]?.trim();
        const isDateLike =
          nextLine &&
          /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(
            nextLine,
          );
        const date = isDateLike ? nextLine : "--";
        rows.push({ type, content, date });
        i += 2;
      } else {
        i++;
      }
    }

    if (rows.length > 0) {
      return (
        <table className="ba-msg-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Details</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${row.type}-${row.content}-${idx}`}>
                <td>
                  <strong>{row.type}</strong>
                </td>
                <td>{row.content}</td>
                <td>{row.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
  }

  // Structured RFC annotation card ("Transfer complete — what just happened:")
  if (text.includes("what just happened:")) {
    const lines = text.split("\n");
    const title = lines[0];
    const entries = [];
    const footer = [];
    let pastFirstBlank = false;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) {
        if (entries.length > 0) pastFirstBlank = true;
        continue;
      }
      if (pastFirstBlank) footer.push(line);
      else entries.push(line);
    }
    return (
      <div className="ba-rfc-card">
        <div className="ba-rfc-card__title">
          <InlineMd text={title} />
        </div>
        {entries.length > 0 && (
          <div className="ba-rfc-card__entries">
            {entries.map((entry, i) => {
              const dash = entry.indexOf(" — ");
              const key = dash >= 0 ? entry.slice(0, dash) : null;
              const val = dash >= 0 ? entry.slice(dash + 3) : entry;
              return (
                <div
                  key={entry}
                  className={`ba-rfc-card__entry${i % 2 ? " ba-rfc-card__entry--alt" : ""}`}
                >
                  {key && <strong className="ba-rfc-card__key">{key}</strong>}
                  {key && <span className="ba-rfc-card__sep"> — </span>}
                  <InlineMd text={val} />
                </div>
              );
            })}
          </div>
        )}
        {footer.length > 0 && (
          <div className="ba-rfc-card__footer">
            {footer.map((line) => (
              <div key={line} className="ba-rfc-card__footer-row">
                <InlineMd text={line} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <MarkdownContent
      text={text}
      className={
        isTokenEvent ? "ba-msg-body ba-msg-body--event" : "ba-msg-body"
      }
    />
  );
}

export function ResultsPanel({ panel, onClose, style }) {
  const [size, setSize] = useState({ width: 340, height: 420 });
  const resizingRef = useRef(null);

  const onResizeMouseDown = useCallback(
    (e, dir) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = size.width;
      const startH = size.height;
      resizingRef.current = { startX, startY, startW, startH, dir };

      const onMove = (ev) => {
        const {
          startX: sx,
          startY: sy,
          startW: sw,
          startH: sh,
          dir: d,
        } = resizingRef.current;
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        setSize({
          width: d === "e" || d === "se" ? Math.max(240, sw + dx) : sw,
          height: d === "s" || d === "se" ? Math.max(160, sh + dy) : sh,
        });
      };
      const onUp = () => {
        resizingRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor =
        dir === "se" ? "nwse-resize" : dir === "e" ? "ew-resize" : "s-resize";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [size],
  );

  if (!panel) return null;
  return (
    <aside
      className="banking-agent-results-panel"
      style={{ ...style, width: size.width, maxHeight: size.height }}
      aria-label="Results"
    >
      <div className="bar-rp-header">
        <span className="bar-rp-title">{panel.title}</span>
        <button
          type="button"
          className="bar-rp-close"
          onClick={onClose}
          aria-label="Close results"
        >
          x
        </button>
      </div>
      <div className="bar-rp-body">
        {panel.type === "accounts" && <AccountsTable accounts={panel.data} terminology={panel.terminology} />}
        {panel.type === "transactions" && (
          <TransactionsTable transactions={panel.data} terminology={panel.terminology} />
        )}
        {panel.type === "balance" && (
          <div className="bar-rp-balance">
            <span className="bar-rp-balance-label">{panel.terminology?.balance || "Balance"}</span>
            <span className="bar-rp-balance-value">
              {formatCurrency(panel.data)}
            </span>
          </div>
        )}
        {panel.type === "confirm" && (
          <div className="bar-rp-confirm">
            <span className="bar-rp-confirm-icon">✅</span>
            <div className="bar-rp-confirm-body">
              <div className="bar-rp-confirm-label">{panel.title}</div>
              {panel.data?.transaction_id && (
                <div>
                  Transaction ID: <code>{panel.data.transaction_id}</code>
                </div>
              )}
              {panel.data?.amount && (
                <div>Amount: {formatCurrency(panel.data.amount)}</div>
              )}
            </div>
          </div>
        )}
        {panel.type === "text" && (
          <div className="bar-rp-text">{panel.data}</div>
        )}
        {panel.type === "vertical" && (
          <VerticalResult descriptor={panel.descriptor} data={panel.data} />
        )}
      </div>
      {/* Resize handles */}
      <div
        className="bar-rp-resize-e"
        onMouseDown={(e) => onResizeMouseDown(e, "e")}
        aria-hidden
      />
      <div
        className="bar-rp-resize-s"
        onMouseDown={(e) => onResizeMouseDown(e, "s")}
        aria-hidden
      />
      <div
        className="bar-rp-resize-se"
        onMouseDown={(e) => onResizeMouseDown(e, "se")}
        aria-label="Resize"
        title="Drag to resize"
      />
    </aside>
  );
}
