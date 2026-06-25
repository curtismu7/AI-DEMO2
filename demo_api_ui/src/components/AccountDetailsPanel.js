import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useDraggablePanel } from '../hooks/useDraggablePanel';
import './AccountDetailsPanel.css';

/**
 * AccountDetailsPanel — draggable, resizable side panel displaying user profile and account details
 */
function AccountDetailsPanel({ accountData, initialPos, onClose }) {
  // eslint-disable-next-line no-unused-vars
  const { pos, size, handleDragStart, handleResizeStart: _handleResizeStart, createResizeHandler } = useDraggablePanel(
    initialPos,
    { w: 750, h: 800 },
    { minW: 400, minH: 320, storageKey: 'account-details-panel' }
  );
  const [collapsed, setCollapsed] = useState(false);

  if (!accountData) return null;

  const { user, accounts } = accountData;

  const panel = (
    <div
      className={`adp-panel${collapsed ? ' adp-panel--collapsed' : ''}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        ...(collapsed ? {} : { height: size.h }),
      }}
      role="dialog"
      aria-label="Account Details"
    >
      {/* Header — drag handle */}
      <div className="adp-header" onPointerDown={handleDragStart}>
        <span className="adp-header-icon" aria-hidden>💼</span>
        <div className="adp-header-text">
          <span className="adp-title">Account Details</span>
          {user?.fullName && <span className="adp-subtitle">{user.fullName}</span>}
        </div>
        <div className="adp-header-actions">
          <button
            type="button"
            className="adp-btn"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand details' : 'Collapse details'}
          >
            {collapsed ? '□' : '—'}
          </button>
          <button
            type="button"
            className="adp-btn adp-btn--close"
            onClick={onClose}
            title="Close"
            aria-label="Close details"
          >
            ×
          </button>
        </div>
      </div>

      {/* Body — scrollable content */}
      {!collapsed && (
        <div className="adp-body">
          {/* User Profile Section */}
          {user && (
            <div className="adp-section">
              <h3 className="adp-section-title">👤 Profile Information</h3>
              <div className="adp-profile">
                <div className="adp-profile-row">
                  <span className="adp-label">Name:</span>
                  <span className="adp-value">{user.fullName || user.username}</span>
                </div>
                {user.email && (
                  <div className="adp-profile-row">
                    <span className="adp-label">Email:</span>
                    <span className="adp-value adp-value--email">{user.email}</span>
                  </div>
                )}
                {user.username && (
                  <div className="adp-profile-row">
                    <span className="adp-label">Username:</span>
                    <span className="adp-value">{user.username}</span>
                  </div>
                )}
                {user.role && (
                  <div className="adp-profile-row">
                    <span className="adp-label">Role:</span>
                    <span className="adp-value adp-value--role">{user.role}</span>
                  </div>
                )}
                {user.accountCreatedAt && (
                  <div className="adp-profile-row">
                    <span className="adp-label">Account Created:</span>
                    <span className="adp-value">{new Date(user.accountCreatedAt).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Accounts Section */}
          {accounts && accounts.length > 0 && (
            <div className="adp-section">
              <h3 className="adp-section-title">🏦 Your Accounts ({accounts.length})</h3>
              <div className="adp-accounts">
                {accounts.map((account, idx) => (
                  <div key={idx} className="adp-account-card">
                    <div className="adp-account-header">
                      <span className="adp-account-type">{account.accountType}</span>
                      <span className={`adp-account-status adp-account-status--${account.status}`}>
                        {account.status}
                      </span>
                    </div>

                    {account.name && (
                      <div className="adp-account-name">{account.name}</div>
                    )}

                    <div className="adp-account-details">
                      <div className="adp-detail-row">
                        <span className="adp-detail-label">Balance:</span>
                        <span className="adp-detail-value">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: account.currency || 'USD',
                          }).format(account.balance || 0)}
                        </span>
                      </div>

                      {account.accountNumber && (
                        <div className="adp-detail-row">
                          <span className="adp-detail-label">Account #:</span>
                          <span className="adp-detail-value adp-detail-value--sensitive">
                            {account.accountNumber}
                          </span>
                        </div>
                      )}

                      {account.accountNumberFull && (
                        <div className="adp-detail-row">
                          <span className="adp-detail-label">Full Account #:</span>
                          <span className="adp-detail-value adp-detail-value--sensitive">
                            {account.accountNumberFull}
                          </span>
                        </div>
                      )}

                      {account.routingNumber && (
                        <div className="adp-detail-row">
                          <span className="adp-detail-label">Routing #:</span>
                          <span className="adp-detail-value adp-detail-value--sensitive">
                            {account.routingNumber}
                          </span>
                        </div>
                      )}

                      {account.swiftCode && (
                        <div className="adp-detail-row">
                          <span className="adp-detail-label">SWIFT Code:</span>
                          <span className="adp-detail-value">{account.swiftCode}</span>
                        </div>
                      )}

                      {account.iban && (
                        <div className="adp-detail-row">
                          <span className="adp-detail-label">IBAN:</span>
                          <span className="adp-detail-value adp-detail-value--sensitive">
                            {account.iban}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!accounts || accounts.length === 0) && (
            <div className="adp-empty">
              <p>No accounts found.</p>
            </div>
          )}

          {/* Educational footer — RFC references */}
          <div className="adp-rfc-footer">
            <span className="adp-rfc-label">🔐 Protected by</span>
            <span className="adp-rfc-item" title="OAuth 2.0 Step-Up Authentication Challenge Protocol — requires higher assurance (MFA) to access sensitive data">RFC 9470 Step-Up Auth</span>
            <span className="adp-rfc-sep">·</span>
            <span className="adp-rfc-item" title="Scope parameter limits what an access token can do — this resource requires sensitive scope">RFC 6749 §3.3 Scope</span>
            <span className="adp-rfc-sep">·</span>
            <span className="adp-rfc-item" title="RFC 8693 Token Exchange — MCP token audience is narrowed to this resource server only">RFC 8693 Token Exchange</span>
          </div>
        </div>
      )}

      {/* Resize handles — all sides and corners */}
      {!collapsed && (
        <>
          {/* Corner handles */}
          <div className="drp-resize-handle drp-resize-handle--nw" onMouseDown={createResizeHandler('nw')} aria-hidden title="Resize from top-left" />
          <div className="drp-resize-handle drp-resize-handle--ne" onMouseDown={createResizeHandler('ne')} aria-hidden title="Resize from top-right" />
          <div className="drp-resize-handle drp-resize-handle--sw" onMouseDown={createResizeHandler('sw')} aria-hidden title="Resize from bottom-left" />
          <div className="drp-resize-handle drp-resize-handle--se" onMouseDown={createResizeHandler('se')} aria-hidden title="Resize from bottom-right" />

          {/* Edge handles */}
          <div className="drp-resize-handle drp-resize-handle--n" onMouseDown={createResizeHandler('n')} aria-hidden title="Resize from top" />
          <div className="drp-resize-handle drp-resize-handle--s" onMouseDown={createResizeHandler('s')} aria-hidden title="Resize from bottom" />
          <div className="drp-resize-handle drp-resize-handle--e" onMouseDown={createResizeHandler('e')} aria-hidden title="Resize from right" />
          <div className="drp-resize-handle drp-resize-handle--w" onMouseDown={createResizeHandler('w')} aria-hidden title="Resize from left" />
        </>
      )}
    </div>
  );

  return ReactDOM.createPortal(panel, document.body);
}

export default AccountDetailsPanel;
