// Pure formatting / normalization helpers extracted from AIAgent.js.
// No React, no JSX, no component state — safe to unit-test in isolation.
// The only external dependency is APP_CONFIG (HITL threshold default).
import APP_CONFIG from "../services/appConfig";
import { formatCurrency as sharedFormatCurrency } from "../utils/formatters";

export function resolveSessionFromAuthTrio(admin, endUser, session) {
  const found =
    admin?.authenticated && admin.user
      ? admin.user
      : endUser?.authenticated && endUser.user
        ? endUser.user
        : session?.authenticated && session.user
          ? session.user
          : null;
  return { found, cookieOnlyBffSession: !!session?.cookieOnlyBffSession };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Re-export shared formatter with USD default for backward compatibility
function formatCurrency(n) {
  return sharedFormatCurrency(n, 'USD');
}

/** Unwrap MCP `tools/call` shape `{ content: [{ text: "<json>" }] }` for display logic. */
export function normalizeAgentToolResult(result) {
  if (!result) return result;
  if (
    result.content &&
    Array.isArray(result.content) &&
    result.content[0]?.text
  ) {
    try {
      return JSON.parse(result.content[0].text);
    } catch {
      return result;
    }
  }

  return result;
}

const _BANKING_ACCT_TYPES = /^(checking|savings|loan|chequing)$/i;

/**
 * Vertical account-type consistency guard — runs immediately after get_my_accounts returns.
 * If the active vertical expects non-banking account types (e.g. "Pro Member") but the MCP
 * result still carries banking labels (CHECKING/SAVINGS — stale data from a reseed race),
 * this rewrites the accountType on each account in-place so every downstream consumer
 * (formatResult, AccountsTable, liveAccounts) sees the correct vertical type without needing
 * its own fallback. Mutates a deep-clone of the response — never the original.
 *
 * @param {object} mcpResponse - raw response from callMcpTool("get_my_accounts")
 * @param {object|null} terminology - active vertical's terminology object (null = banking)
 * @returns {object} - mcpResponse with accountTypes corrected if needed, or original if not
 */
export function enforceVerticalAccountTypes(mcpResponse, terminology) {
  const verticalTypes = terminology?.accountTypes;
  if (!verticalTypes?.length || !mcpResponse) return mcpResponse;

  const normalized = normalizeAgentToolResult(mcpResponse);
  const accounts = normalized?.accounts;
  if (!Array.isArray(accounts) || !accounts.length) return mcpResponse;

  const hasStaleBankingType = accounts.some(
    (a) => _BANKING_ACCT_TYPES.test(a.accountType || a.account_type || a.type || "")
  );
  if (!hasStaleBankingType) return mcpResponse;

  // Stale banking types detected — rewrite in a cloned response tree
  const patched = accounts.map((a, idx) => {
    const raw = a.accountType || a.account_type || a.type || "";
    if (_BANKING_ACCT_TYPES.test(raw)) {
      const correctType = verticalTypes[idx] || verticalTypes[0];
      return { ...a, accountType: correctType, account_type: correctType, type: correctType };
    }
    return a;
  });

  // Rebuild the MCP content blob with the patched accounts
  try {
    const inner = { ...normalized, accounts: patched };
    if (mcpResponse?.content?.[0]?.text) {
      return {
        ...mcpResponse,
        content: [{ ...mcpResponse.content[0], text: JSON.stringify(inner) }],
      };
    }
    return inner;
  } catch {
    return mcpResponse;
  }
}

/**
 * Build the payload expected by POST /api/transactions/consent-challenge
 * from the agent actionId + form values (same keys used in runAction).
 */
export function buildConsentIntent(actionId, form) {
  const amount = parseFloat(form.amount);
  if (actionId === "deposit") {
    return {
      type: "deposit",
      toAccountId: form.accountId || form.toId,
      fromAccountId: null,
      amount,
      description: form.note || "Agent deposit",
    };
  }
  if (actionId === "withdraw") {
    return {
      type: "withdrawal",
      fromAccountId: form.accountId || form.fromId,
      toAccountId: null,
      amount,
      description: form.note || "Agent withdrawal",
    };
  }
  if (actionId === "transfer" || actionId === "transfer_600_test") {
    return {
      type: "transfer",
      fromAccountId: form.fromId,
      toAccountId: form.toId,
      amount,
      description: form.note || "Agent transfer",
    };
  }
  return null;
}

/** Maps MCP JSON (including deposit/transfer/withdraw shapes) to results panel + dashboard event types. */
export function inferAgentResultTypeAndData(normalized) {
  if (!normalized || typeof normalized !== "object")
    return { resultType: null, resultData: null };
  if (normalized.accounts)
    return { resultType: "accounts", resultData: normalized.accounts };
  if (normalized.transactions)
    return { resultType: "transactions", resultData: normalized.transactions };
  if (normalized.balance !== undefined && normalized.error === undefined) {
    return { resultType: "balance", resultData: normalized.balance };
  }
  if (normalized.transaction_id || normalized.transactionId || normalized.id) {
    return { resultType: "confirm", resultData: normalized };
  }
  if (normalized.transaction?.id)
    return { resultType: "confirm", resultData: normalized };
  if (
    normalized.success === true &&
    (normalized.operation === "transfer" ||
      normalized.operation === "deposit" ||
      normalized.operation === "withdrawal")
  ) {
    return { resultType: "confirm", resultData: normalized };
  }
  return { resultType: null, resultData: null };
}

/** True when the tool returned an error object (local MCP or consent JSON), not a data payload. */
export function isAgentToolErrorResult(normalized) {
  if (!normalized || typeof normalized !== "object") return false;
  if (normalized.accounts || normalized.transactions) return false;
  if (normalized.transaction_id || normalized.transactionId || normalized.id)
    return false;
  if (normalized.balance !== undefined && normalized.error === undefined)
    return false;
  return Boolean(normalized.error);
}

/** Format HTTP trace entries (MCP server → banking API calls) for display in chat */
export function formatHttpTrace(trace) {
  if (!trace || trace.length === 0) return "";
  const lines = ["\n\n Banking API calls:"];
  trace.forEach((entry, i) => {
    const status = entry.status
      ? ` → ${entry.status} ${entry.ok ? "✅" : "❌"}`
      : entry.ok
        ? " ✅"
        : " ❌";
    lines.push(
      `\n${i + 1}. ${entry.method} ${entry.url}${status} (${entry.durationMs}ms)`,
    );
    if (entry.requestBody) {
      const body = JSON.stringify(entry.requestBody, null, 2).slice(0, 300);
      lines.push(`\n// Request body\n${body}\n`);
    }
    if (entry.responseBody !== undefined) {
      const resp = JSON.stringify(entry.responseBody, null, 2).slice(0, 400);
      lines.push(`\n// Response\n${resp}\n`);
    }
    if (entry.error) {
      lines.push(`_Error: ${entry.error}_`);
    }
  });
  return lines.join("\n");
}

/**
 * Build the RFC security summary string shown as a token-event chat message.
 * Shared between the direct tool path (runAction) and the NL agent path.
 * Returns null when there is nothing noteworthy to display.
 */
export function buildTokenEventMsg(tokenEvents, { localFallback = false } = {}) {
  if (!Array.isArray(tokenEvents) || tokenEvents.length === 0) return null;
  const exchanged = tokenEvents.find(
    (e) => e.id === "exchanged-token" || e.id === "two-ex-final-token" || e.id === "two-ex-exchange1",
  );
  const required = tokenEvents.find((e) => e.id === "exchange-required");
  const badScopes = tokenEvents.find((e) => e.id === "user-scopes-insufficient");
  const failed = tokenEvents.find((e) => e.id === "exchange-failed");
  const JWKS_VER_IDS = new Set([
    "exchanged-token-verified", "agent-actor-token-verified",
    "two-ex-agent-actor-verified", "two-ex-exchange1-verified",
    "two-ex-mcp-actor-verified", "two-ex-final-token-verified",
  ]);
  const jwksVerified = tokenEvents.find((e) => JWKS_VER_IDS.has(e.id) && e.extra?.verified);
  const jwksDegraded = jwksVerified?.extra?.fallbackMethod === "introspection";
  if (exchanged) {
    // Expanded teaching copy (requested 2026-08-10, "really expand the
    // description of the RFC"): each RFC carries a plain-English line about
    // what it is and what just happened, not just a pass mark. RFC info is an
    // opt-in toggle, so length is a feature here, not noise. No markdown
    // markers — uiRegression.test.js bans ** and code fences in chat strings.
    const audValue = exchanged.audienceNarrowed
      || (Array.isArray(exchanged.claims?.aud) ? exchanged.claims.aud.join(", ") : exchanged.claims?.aud)
      || "—";
    const introspectionLines = [
      "✅ RFC 7662 — Token Introspection",
      "   Before anything ran, the BFF asked PingOne directly: is this user",
      "   token genuine, unexpired, and unrevoked? The issuer itself vouched",
      "   for it — nothing here trusts a token on sight.",
    ];
    const exchangeLines = [
      "✅ RFC 8693 — OAuth 2.0 Token Exchange",
      "   The user's token was traded for a NEW, narrower token minted just",
      "   for this agent call: different audience, smaller scope, and an act",
      "   claim recording who is acting on whose behalf. The agent never",
      "   holds or forwards the user's own token.",
    ];
    const jwksLines = jwksDegraded
      ? [
          "⚠️ RFC 7515 — JWS Signature (degraded)",
          "   PingOne's JWKS endpoint was unreachable, so the exchanged token",
          "   was verified via RFC 7662 introspection instead — still",
          "   issuer-confirmed, but by lookup rather than by signature.",
        ]
      : jwksVerified?.extra?.verified
        ? [
            "✅ RFC 7515 — JWS Signature",
            `   The exchanged token's signature was checked against PingOne's`,
            `   published keys (${jwksVerified.extra.alg || "RS256"}, kid: ${jwksVerified.extra.kid || "—"}) —`,
            "   cryptographic proof it was minted by PingOne and not altered.",
          ]
        : [
            "   RFC 7515 — JWS Signature (not verified this turn)",
          ];
    const audLines =
      exchanged.audExpected !== undefined && exchanged.audMatches
        ? [
            "✅ RFC 8707 — Resource Indicators",
            `   The token's aud is pinned to exactly "${exchanged.audActual ?? exchanged.audienceNarrowed}".`,
            "   Even a stolen copy of this token is useless at any other API —",
            "   the resource server rejects tokens not addressed to it.",
          ]
        : exchanged.audExpected !== undefined
          ? [
              "❌ RFC 8707 — Resource Indicators",
              `   aud mismatch — got "${exchanged.audActual}", expected "${exchanged.audExpected}".`,
              "   The receiving API must refuse this token.",
            ]
          : [
              "✅ RFC 8707 — Resource Indicators",
              `   The token's aud is bound to: ${audValue}. Tokens addressed to`,
              "   one API cannot be replayed against another.",
            ];
    const actStatus = exchanged.actPresent
      ? `✅ BFF confirmed — ${exchanged.actDetails || "delegation proof present"}`
      : "⚠️ subject-only exchange (no delegation proof)";
    return [
      "Security Verification — RFC 8693 Token Exchange",
      "",
      ...introspectionLines,
      "",
      ...exchangeLines,
      "",
      ...jwksLines,
      "",
      ...audLines,
      "",
      "What the exchanged token actually says:",
      `act:      ${actStatus}`,
      "          (the delegation chain — which agent is acting for which human)",
      `aud:      ${audValue}`,
      "          (the one API this token is addressed to)",
      `scope:    ${exchanged.scopeNarrowed || exchanged.claims?.scope || "—"} (narrowed)`,
      "          (smaller than the user's own grant — least privilege applied)",
    ].join("\n");
  }
  if (required) {
    return [
      "Token Exchange (RFC 8693): not configured",
      "   Tools ran via local fallback — the user access token was NOT sent to the MCP server.",
      "",
      "To enable full RFC 8693 exchange:",
      '   1. Create a PingOne Resource Server  audience: "demo_mcp_server"',
      "   2. Set MCP_RESOURCE_URI=demo_mcp_server  (Config UI or Vercel env)",
      "   3. Enable Token Exchange grant on the Admin OAuth app in PingOne",
      "   4. Sign out and sign in again",
    ].join("\n");
  }
  if (badScopes) {
    return [
      "⚠️ User token has insufficient scopes for RFC 8693 exchange",
      `   ${badScopes.explanation || "Need at least 5 OAuth scopes on the user token"}`,
      "",
      "Fix: Sign out → sign in again with a PingOne app that requests more scopes",
      "(openid, profile, email + banking scopes like read, accounts:read).",
    ].join("\n");
  }
  if (failed) {
    if (localFallback) {
      return [
        "⚠️ Token Exchange (RFC 8693) skipped — ran via local fallback",
        "   The exchange was attempted but PingOne could not grant the required scopes.",
        "   The banking operation completed successfully using the local handler.",
        "",
        "   To enable full RFC 8693 exchange, ensure the user token carries",
        "   read / write scopes (not just ai:agent:read).",
      ].join("\n");
    }
    return [
      `❌ Token Exchange (RFC 8693) failed: ${failed.error || "unknown error"}`,
      "",
      "   Check that:\n   • PingOne has Token Exchange grant enabled on the admin OAuth app\n   • Audience policy allows \"demo_mcp_server\"\n   • The delegated token carries a valid act claim for this agent",
    ].join("\n");
  }
  // Fallback: the turn carried token activity but nothing exchange-shaped —
  // e.g. the pingone-admin vertical, which runs on a worker client_credentials
  // token with deliberately NO RFC 8693 exchange. Summarize what DID happen so
  // the RFC info toggle is never a silent no-op ("RFC info not working",
  // reported live 2026-08-10 — the toggle was on, the builder returned null).
  const summaryLines = tokenEvents
    .filter((e) => e && (e.title || e.id))
    .slice(0, 8)
    .map((e) => {
      const mark = e.status === "failed" ? "❌" : e.status === "warning" ? "⚠️" : "✅";
      const rfc = e.extra?.rfc ? `  (${e.extra.rfc})` : "";
      return `${mark} ${e.title || e.id}${rfc}`;
    });
  if (!summaryLines.length) return null;
  return [
    "Security Verification — token activity (no RFC 8693 exchange this turn)",
    "",
    "This agent runs on its own machine identity: an RFC 6749 §4.4",
    "client_credentials token the BFF obtains directly — no user token is",
    "exchanged and no act chain exists, because no human's credentials are",
    "being delegated. What gates each call instead is the worker app's",
    "assigned roles and, on the admin vertical, live directory group",
    "membership re-read per request. Different trust model, same rule:",
    "every call is authorized, none is assumed.",
    "",
    ...summaryLines,
  ].join("\n");
}

export function formatResult(result, terminology) {
  const termAccount = terminology?.account || "Account";
  const termBalance = terminology?.balance || "Balance";
  const r = normalizeAgentToolResult(result);
  if (!r) return "No data returned.";
  if (r.error === "hitl_required") {
    const t = r.hitl_threshold_usd ?? APP_CONFIG.THRESHOLDS.HITL_DEFAULT;
    return `${r.message || "Human approval is required for this amount."}\n\nUse the main dashboard to complete the consent flow for amounts over $${t}. The assistant cannot supply a browser consent challenge.`;
  }
  if (isAgentToolErrorResult(r)) {
    let errorMsg = `❌ ${typeof r.message === "string" ? r.message : r.error}`;
    // Include original MCP request for debugging
    if (r.originalRequest) {
      const reqStr = JSON.stringify(r.originalRequest, null, 2).slice(0, 500); // Truncate for display
      errorMsg += `\n\n Original request:\n\n${reqStr}${Object.keys(r.originalRequest).length > 5 ? "\n..." : ""}\n`;
    }
    // Include HTTP trace (request → response to banking API)
    if (r.httpTrace && r.httpTrace.length > 0) {
      errorMsg += formatHttpTrace(r.httpTrace);
    }
    return errorMsg;
  }
  // Accounts list
  if (r.accounts) {
    const BANKING_TYPES = /^(checking|savings|loan|chequing)$/i;
    const verticalTypes = terminology?.accountTypes || [];
    return r.accounts
      .filter(Boolean)
      .map((a, idx) => {
        // Use the actual account type from the server — vertical-seeded accounts carry the
        // correct domain type (e.g. "Pro Member", "Primary Care"). Fool-proof fallback: if
        // we're in a non-banking vertical but the server returned a banking type (stale data
        // from a race on reseed), substitute the vertical's accountTypes label so the user
        // never sees "CHECKING" or "SAVINGS" in a sports/healthcare/retail context.
        let rawType = a.accountType || a.account_type || a.type || "";
        if (terminology && verticalTypes.length && BANKING_TYPES.test(rawType)) {
          rawType = verticalTypes[idx] || verticalTypes[0] || termAccount;
        }
        const displayType = rawType || termAccount;
        const num = a.accountNumber || a.account_number || "";
        const name = (!terminology && a.name && a.name !== a.id)
          ? `${a.name} (${num || "—"})`
          : `${displayType} (${num || "—"})`;

        return `${name} — ${formatCurrency(a.balance)} ${a.currency || "USD"}`;
      })
      .join("\n\n");
  }
  // Transactions list
  if (r.transactions) {
    return r.transactions
      .slice(0, 10)
      .map(
        (t) =>
          `${t.type}: ${formatCurrency(t.amount)} — ${t.description || ""}\n  ${new Date(t.date || t.created_at || t.createdAt).toLocaleDateString()}`,
      )
      .join("\n\n");
  }
  // Balance response
  if (r.balance !== undefined) {
    return `${termBalance}: ${formatCurrency(r.balance)}`;
  }
  // Account nickname (get_account_nickname)
  if (r.nickname !== undefined) {
    return `${termAccount} nickname: ${r.nickname}`;
  }
  // Add-to-cart confirmation (sporting-goods cart entry: { productId, name, price, addedAt }).
  // Checked before the generic transaction-id branch below, which would otherwise
  // match on r.id and print a confusing "Transaction confirmed" with no amount.
  if (r.productId && r.name && r.addedAt) {
    return `Added ${r.name}${typeof r.price === "number" ? ` (${formatCurrency(r.price)})` : ""} to your cart.`;
  }
  // Transaction confirmation (single transaction)
  if (r.transaction_id || r.transactionId || r.id) {
    return `Transaction confirmed\nTransaction ID: ${r.transaction_id || r.transactionId || r.id}\nAmount: ${formatCurrency(r.amount)}`;
  }
  // Transfer / deposit / withdrawal confirmation (MCP server shape: success + operation)
  if (r.success === true && r.operation) {
    const op = r.operation;
    const lines = [
      r.message || `${op.charAt(0).toUpperCase() + op.slice(1)} confirmed`,
    ];
    if (op === "transfer") {
      lines.push(`Amount: ${formatCurrency(r.amount)}`);
      lines.push(`From: ${r.fromAccountId}  →  To: ${r.toAccountId}`);
    } else if (op === "deposit") {
      lines.push(`Amount: ${formatCurrency(r.amount)}`);
      lines.push(`To: ${r.toAccountId}`);
    } else if (op === "withdrawal") {
      lines.push(`Amount: ${formatCurrency(r.amount)}`);
      lines.push(`From: ${r.fromAccountId}`);
    }
    if (r.withdrawalTransaction?.id)
      lines.push(`Debit ID: ${r.withdrawalTransaction.id}`);
    if (r.depositTransaction?.id)
      lines.push(`Credit ID: ${r.depositTransaction.id}`);
    if (r.transactionId || r.transaction?.id)
      lines.push(`Transaction ID: ${r.transactionId || r.transaction?.id}`);
    return lines.join("\n");
  }
  return JSON.stringify(r, null, 2);
}

// ─── Exported terminology helpers (used in tests and internally) ──────────────

/** Returns the appropriate results panel title using vertical terminology. */
export function buildResultsPanelTitle(resultType, terminology) {
  if (resultType === "accounts") return terminology?.accounts || "Accounts";
  if (resultType === "transactions") return terminology?.transactions || "Recent Transactions";
  if (resultType === "balance") return terminology?.balance || "Balance";
  return resultType || "Results";
}

/** Returns the clarification question strings, adjusted for vertical terminology. */
export function buildClarificationQuestions(terminology) {
  const termAccounts  = terminology?.accounts       || "accounts";
  const termHighValue = terminology?.highValueAction || "Transfer";
  const termTypes     = terminology?.accountTypes    || ["checking", "savings"];
  return {
    transfer: `Which ${termAccounts} would you like to ${termHighValue.toLowerCase()} between? (e.g. ${termTypes[0] || "account"} to ${termTypes[1] || "account"})`,
    accounts: `Which ${termAccounts} would you like to view?`,
  };
}

// ─── Session / greeting / prompt-parsing helpers (pure) ───────────────────────

/**
 * Chat copy when the BFF has a cookie but no live OAuth tokens.
 * Adapts to store quota/auth errors vs. healthy Redis but missing OAuth tokens in this session.
 */
export function buildSessionNotHydratedChat(storeError, sessionStoreHealthy = null) {
  const isQuota =
    storeError && storeError.includes("max requests limit exceeded");
  const isMissingAuth =
    storeError &&
    (storeError.includes("WRONGPASS") || storeError.includes("unauthorized"));

  let secondLine;
  if (isQuota) {
    secondLine =
      "The Upstash Redis daily request quota is exhausted — the session store cannot save or load tokens until the quota resets.";
  } else if (isMissingAuth) {
    secondLine =
      "The session store rejected credentials (WRONGPASS or unauthorized).";
  } else if (storeError) {
    secondLine = `The session store reported an error: ${storeError}`;
  } else if (sessionStoreHealthy === true) {
    secondLine =
      "The session store is healthy, but this browser session does not have OAuth access tokens. The server rebuilt your identity from the signed _auth cookie (sessionRestored / accessTokenStub in session debug).";
  } else {
    secondLine =
      'This session has no OAuth tokens (cookie-only or failed save after login). It is not the same as "Redis is down".';
  }

  const lines = [
    "Your browser shows you as signed in, but the AI Agent needs OAuth tokens on the server for MCP and NL.",
    secondLine,
    "",
    'Diagnose: use "Open session debug" (uses ?deep=1) — compares Redis row vs req.session; sessionStoreHealthy can be true while accessTokenStub is true.',
    "",
  ];

  if (isQuota) {
    lines.push(
      "Fix options:",
      "  1. Wait — Upstash free-tier quota resets at midnight UTC automatically.",
      "  2. Upgrade — go to console.upstash.com and upgrade the database to Pay-As-You-Go.",
      "  3. Recreate — create a new Upstash database and update KV_REST_API_URL + KV_REST_API_TOKEN in Vercel.",
      "",
      "After the quota resets or the database is replaced, sign out and sign in again.",
    );
  } else if (isMissingAuth) {
    lines.push(
      "Fix: In Vercel → Settings → Environment Variables, confirm these are set and correct:",
      "  • KV_REST_API_URL",
      "  • KV_REST_API_TOKEN",
      "Apply to Production, redeploy, sign out, sign in again.",
    );
  } else if (storeError) {
    lines.push(
      "Fix: sign out and sign in again after the store error is resolved. Check Vercel logs for session-store or OAuth callback errors.",
    );
  } else {
    lines.push(
      "Fix:",
      "  1. Sign out completely, then sign in again with PingOne (writes fresh tokens into the server session).",
      '  2. If it still happens right after login, check Vercel logs for "[oauth/user/callback] Session save FAILED".',
    );
  }

  lines.push(
    "",
    sessionStoreHealthy === true
      ? '"Refresh access token" only helps if the server already holds a refresh token. With a stub token, use Sign out and sign in again.'
      : 'After a fresh login you want sessionStoreType: "upstash-rest" and sessionStoreHealthy: true. "Refresh access token" cannot fix a missing session store.',
  );

  return lines.join("\n");
}

/** Fallback when session response is not available (no healthy flag). */
export const SESSION_NOT_HYDRATED_CHAT = buildSessionNotHydratedChat(null, null);

export function buildCustomerGreeting(u, manifestGreeting) {
  const name = (u && (u.firstName || (u.name && u.name.split(' ')[0]))) || 'there';
  if (manifestGreeting) return manifestGreeting.replace('{name}', name);
  return `Hi ${name}! I'm your AI assistant. I can help with your accounts, explain the OAuth flows behind the scenes, and more. What would you like to do?`;
}

export function welcomeMessage(
  u,
  focus = "banking",
  brandShortName = "AI Demo",
  customerGreetingOverride = null,
) {
  if (focus === "config") {
    if (!u) {
      return `Ask about PingOne, redirect URIs, OAuth scopes, Agent MCP scopes (limit transfers vs read-only), environment variables, and industry branding (${brandShortName} vs other presets) for this demo.`;
    }
    const name = u.firstName || u.name?.split(" ")[0] || "there";
    if (u.role === "admin") {
      return `Hi ${name} — you're on Application Configuration. Ask about environment IDs, worker apps, redirect URIs, OAuth, Industry & branding (ui_industry_preset), or Agent MCP scopes (agent_mcp_allowed_scopes) — turn off transfers for a read-only agent demo; the BFF runs RFC 8693 token exchange on each tool call with the selected scopes. Banking shortcuts are hidden here. Theme: ${brandShortName}.`;
    }
    return `Hi ${name} — you're on Application Configuration. Ask how to connect PingOne, switch branding (e.g. FunnyBank), or limit the agent with Agent MCP scopes (e.g. disable transfers). Theme: ${brandShortName}.`;
  }
  if (!u) return "You're signed in! What would you like to do?";
  const name = u.firstName || u.name?.split(" ")[0] || "there";
  if (u.role === "admin") {
    return `Welcome, ${name}! As an admin you can query accounts system-wide, view all transactions, manage users, and explore PingOne OAuth flows. What would you like to do?`;
  }
  return buildCustomerGreeting(u, customerGreetingOverride);
}

export function normalizeBankingParams(params) {
  const p = { ...(params || {}) };
  if (p.account_id && !p.accountId) p.accountId = p.account_id;
  if (p.from_account_id && !p.fromId) p.fromId = p.from_account_id;
  if (p.to_account_id && !p.toId) p.toId = p.to_account_id;
  return p;
}

/**
 * Parses simple log-focused prompts into a structured query command.
 */
export function parseLogPrompt(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  const errorMatch =
    lower.match(
      /(?:show|list|give me|get)\s+(?:me\s+)?(?:the\s+)?last\s+(\d+)\s+errors?/,
    ) || lower.match(/last\s+(\d+)\s+errors?/);
  if (errorMatch) {
    return {
      type: "errors",
      limit: Math.min(Math.max(parseInt(errorMatch[1], 10) || 5, 1), 50),
    };
  }

  const loginMatch =
    lower.match(/last\s+success(?:ful)?\s+login\s+for\s+([a-z0-9._@-]+)/i) ||
    lower.match(/last\s+login\s+for\s+([a-z0-9._@-]+)/i);
  if (loginMatch) {
    return { type: "last_login", username: loginMatch[1] };
  }

  return null;
}
