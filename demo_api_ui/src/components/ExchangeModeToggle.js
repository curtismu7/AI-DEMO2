// banking_api_ui/src/components/ExchangeModeToggle.js
import React, { useState, useEffect } from 'react';
import bffAxios from '../services/bffAxios';
import './ExchangeModeToggle.css';

/**
 * Dual-mode token exchange display (RFC 8693 and Transaction Tokens).
 * Detects active mode from /api/tokens/session-preview and displays
 * mode-specific token table and metadata.
 */
function inferTokenMode(tokenEvents) {
  if (!tokenEvents || tokenEvents.length === 0) return 'rfc_8693';
  const hasTransactionId = tokenEvents.some(
    (e) => e.decoded?.payload?.txn_id || e.decoded?.payload?.txn_scope
  );
  if (hasTransactionId) return 'transaction_tokens';
  return 'rfc_8693';
}

export default function ExchangeModeToggle({ hideTable = false }) {
  const [tokenMode, setTokenMode] = useState(null);
  const [txnMeta, setTxnMeta] = useState(null);
  // Embedded token chain (hideTable) starts collapsed to save vertical space.
  const [collapsed, setCollapsed] = useState(hideTable);

  useEffect(() => {
    let cancelled = false;
    bffAxios.get('/api/tokens/session-preview')
      .then((res) => {
        if (cancelled) return;
        const events = res.data?.tokenEvents || [];
        const explicitMode = res.data?.tokenExchangeMode;
        const mode = explicitMode || inferTokenMode(events);
        setTokenMode(mode);
        if (mode === 'transaction_tokens') {
          const txnEvent = events.find(
            (e) => e.decoded?.payload?.txn_id || e.decoded?.payload?.txn_scope
          );
          if (txnEvent) {
            setTxnMeta({
              txn_id: txnEvent.decoded?.payload?.txn_id,
              txn_scope: txnEvent.decoded?.payload?.txn_scope,
            });
          }
        }
      })
      .catch(() => { if (!cancelled) setTokenMode('rfc_8693'); });
    return () => { cancelled = true; };
  }, []);

  const isTransaction = tokenMode === 'transaction_tokens';

  return (
    <div className="emt-root">
      <div className={`emt-header emt-header--clickable${collapsed ? ' emt-header--collapsed' : ''}`} onClick={() => setCollapsed(c => !c)}>
        <span className="emt-label">Token Exchange Mode</span>
        <div className="emt-header-right">
          {tokenMode ? (
            <span className={`emt-rfc${isTransaction ? ' emt-rfc--transaction' : ''}`}>
              {isTransaction ? 'Transaction Tokens (draft)' : 'RFC 8693 Delegation'}
            </span>
          ) : (
            <span className="emt-rfc emt-rfc--loading">Loading…</span>
          )}
          <span className="emt-chevron">{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          <p className="emt-desc-main">
            {isTransaction ? (
              <>
                <strong>Transaction delegation:</strong> User Token → Agent Token → Transaction Token{' '}
                (<code>txn_id</code> + transaction context)
              </>
            ) : (
              <>
                <strong>Chained delegation:</strong> User Token → Agent Token → Delegated Access Token (nested <code>act</code> claim)
              </>
            )}
          </p>

          <div className="emt-explainer">
            {isTransaction ? (
              <p>
                Each call mints a fresh <strong>Transaction Token</strong> carrying a unique
                {' '}<code>txn_id</code> and <code>txn_scope</code>, so every operation is
                individually authorized, auditable, and safe from replay. The agent never
                holds the user&rsquo;s credentials — only PingOne can issue the token.
              </p>
            ) : (
              <p>
                PingOne runs an <strong>RFC 8693 token exchange</strong>: the user&rsquo;s
                token is the <code>subject_token</code> and the agent&rsquo;s token is the
                {' '}<code>actor_token</code>. The result is a short-lived, narrowly-scoped
                delegated token whose nested <code>act</code> claim proves &ldquo;agent acting
                for user.&rdquo; The user and agent tokens stay secret on the BFF — only the
                delegated token reaches the MCP server.
              </p>
            )}
            <p className="emt-explainer-hint">
              Each step in the Token Chain below is one hop of this exchange —
              {' '}<strong>click any step</strong> to inspect its request, policy decision, and resulting scopes.
            </p>
          </div>

          {/* Token Types Table */}
          {!hideTable && (
            <div className="emt-tokens-table">
              <div className="emt-tokens-header">
                <span className="emt-tokens-col-name">Token Type</span>
                <span className="emt-tokens-col-noun">Full Name</span>
                <span className="emt-tokens-col-source">Issued By</span>
                <span className="emt-tokens-col-use">
                  {isTransaction ? 'Role in Transaction' : 'RFC 8693 Role'}
                </span>
              </div>

              <div className="emt-token-row emt-token-row--user">
                <span className="emt-tokens-col-name"><strong>User Token</strong></span>
                <span className="emt-tokens-col-noun">User access token</span>
                <span className="emt-tokens-col-source">PingOne OIDC login</span>
                <span className="emt-tokens-col-use">
                  {isTransaction ? 'Subject in exchange' : <><code>subject_token</code> (Exchange #1)</>}
                </span>
              </div>

              <div className="emt-token-row emt-token-row--agent">
                <span className="emt-tokens-col-name"><strong>Agent Token</strong></span>
                <span className="emt-tokens-col-noun">Agent access token</span>
                <span className="emt-tokens-col-source">Client credentials grant</span>
                <span className="emt-tokens-col-use">
                  {isTransaction ? 'Actor in exchange' : <><code>actor_token</code> (Exchange #1 &amp; #2)</>}
                </span>
              </div>

              <div className="emt-token-row emt-token-row--mcp">
                <span className="emt-tokens-col-name"><strong>{isTransaction ? 'Transaction Token' : 'MCP Token'}</strong></span>
                <span className="emt-tokens-col-noun">{isTransaction ? 'Transaction access token' : 'Delegated access token'}</span>
                <span className="emt-tokens-col-source">{isTransaction ? 'Transaction token exchange' : 'RFC 8693 exchange'}</span>
                <span className="emt-tokens-col-use">
                  {isTransaction
                    ? <><code>txn_id</code> + agent context</>
                    : <>Result with nested <code>act</code> claim (to MCP Server)</>}
                </span>
              </div>

              {isTransaction && (
                <>
                  <div className="emt-token-row emt-token-row--transaction">
                    <span className="emt-tokens-col-name"><strong>Transaction ID</strong></span>
                    <span className="emt-tokens-col-noun">Unique exchange identifier</span>
                    <span className="emt-tokens-col-source">
                      {txnMeta?.txn_id ? <code className="emt-txn-id">{txnMeta.txn_id}</code> : 'Generated per exchange'}
                    </span>
                    <span className="emt-tokens-col-use">Audit trail / replay prevention</span>
                  </div>
                  <div className="emt-token-row emt-token-row--transaction">
                    <span className="emt-tokens-col-name"><strong>Txn Scope</strong></span>
                    <span className="emt-tokens-col-noun">Operation intent</span>
                    <span className="emt-tokens-col-source">
                      {txnMeta?.txn_scope ? <code>{txnMeta.txn_scope}</code> : 'Exchange metadata'}
                    </span>
                    <span className="emt-tokens-col-use">Fine-grained operation authorization</span>
                  </div>
                </>
              )}
            </div>
          )}

          {!hideTable && (
            <p className="emt-note">
              {isTransaction ? (
                <>
                  🔬 <strong>Draft mode active:</strong> Transaction Tokens add per-operation context (
                  <code>txn_id</code>, <code>txn_scope</code>) to each delegation.
                  {' '}Set <code>TOKEN_EXCHANGE_MODE=rfc_8693</code> in BFF <code>.env</code> to switch back.
                </>
              ) : (
                <>
                  ℹ️ <strong>Security guarantee:</strong> User Token and Agent Token are secrets — stored only on the Backend-for-Frontend (BFF).
                  Only the Delegated Access Token (limited scope + nested delegation proof) reaches the MCP Server.
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
