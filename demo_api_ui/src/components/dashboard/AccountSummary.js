// banking_api_ui/src/components/dashboard/AccountSummary.js
import React, { useState, useMemo } from 'react';
import { useVertical } from '../../vertical/useVertical';
import './AccountSummary.css';

/** Format a number as USD currency — $1,234.56 */
const fmt = (n) =>
  typeof n === 'number'
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '$0.00';

/** Account types whose balances represent money owed (liabilities), not assets. */
const DEBT_TYPES = new Set(['car_loan', 'mortgage', 'credit']);

const AccountSummary = ({ accounts, isDemoMode, onNavigateToLogin, expandedAccounts, onToggleAccount }) => {
  const { activeId: currentVertical } = useVertical();
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'

  // Calculate summary statistics
  const summary = useMemo(() => {
    const totalAssets = accounts
      .filter(account => !DEBT_TYPES.has(account.accountType || account.type))
      .reduce((sum, account) => sum + (account.balance || 0), 0);
    
    const totalDebts = accounts
      .filter(account => DEBT_TYPES.has(account.accountType || account.type))
      .reduce((sum, account) => sum + Math.abs(account.balance || 0), 0);
    
    const netWorth = totalAssets - totalDebts;
    
    const accountTypes = {};
    accounts.forEach(account => {
      const type = account.accountType || account.type || 'unknown';
      if (!accountTypes[type]) {
        accountTypes[type] = { count: 0, total: 0 };
      }
      accountTypes[type].count++;
      accountTypes[type].total += account.balance || 0;
    });

    return {
      totalAssets,
      totalDebts,
      netWorth,
      accountCount: accounts.length,
      accountTypes
    };
  }, [accounts]);

  // Get account type icon and color
  const getAccountTypeInfo = (type) => {
    const typeLower = (type || 'unknown').toLowerCase();
    
    switch (typeLower) {
      case 'checking':
        return { icon: '💳', color: 'var(--color-primary-500)', bgColor: 'var(--color-primary-50)' };
      case 'savings':
        return { icon: '🏦', color: 'var(--color-success-500)', bgColor: 'var(--color-success-50)' };
      case 'credit':
        return { icon: '💳', color: 'var(--color-warning-500)', bgColor: 'var(--color-warning-50)' };
      case 'mortgage':
        return { icon: '🏠', color: 'var(--color-error-500)', bgColor: 'var(--color-error-50)' };
      case 'car_loan':
        return { icon: '🚗', color: 'var(--color-secondary-500)', bgColor: 'var(--color-secondary-50)' };
      case 'investment':
        return { icon: '📈', color: 'var(--color-primary-600)', bgColor: 'var(--color-primary-100)' };
      default:
        return { icon: '📋', color: 'var(--color-secondary-500)', bgColor: 'var(--color-secondary-50)' };
    }
  };

  // Get vertical-specific features
  const getVerticalFeatures = () => {
    switch (currentVertical) {
      case 'retail':
        return {
          title: 'Store Performance',
          metrics: ['Daily Sales', 'Inventory Value', 'Cash Flow'],
          primaryMetric: 'Total Revenue'
        };
      case 'workforce':
        return {
          title: 'Workforce Overview',
          metrics: ['Active Employees', 'Payroll Total', 'Benefits Value'],
          primaryMetric: 'Total Compensation'
        };
      case 'banking':
      default:
        return {
          title: 'Financial Overview',
          metrics: ['Total Assets', 'Total Debts', 'Net Worth'],
          primaryMetric: 'Net Worth'
        };
    }
  };

  const verticalFeatures = getVerticalFeatures();

  // Render summary cards
  const renderSummaryCards = () => {
    const cards = currentVertical === 'retail'
      ? [
          { label: 'Daily Sales', value: fmt(summary.totalAssets), change: '+12.3%', positive: true },
          { label: 'Total Orders', value: summary.accountCount.toString(), change: '+5.2%', positive: true },
          { label: 'Avg Order Value', value: fmt(summary.totalAssets / summary.accountCount), change: '-2.1%', positive: false }
        ]
      : currentVertical === 'workforce'
      ? [
          { label: 'Active Employees', value: summary.accountCount.toString(), change: '+2.1%', positive: true },
          { label: 'Total Payroll', value: fmt(summary.totalAssets), change: '+8.7%', positive: true },
          { label: 'Benefits Value', value: fmt(summary.totalDebts), change: '+3.2%', positive: true }
        ]
      : [
          { label: 'Total Assets', value: fmt(summary.totalAssets), change: '+5.2%', positive: true },
          { label: 'Total Debts', value: fmt(summary.totalDebts), change: '-2.1%', positive: true },
          { label: 'Net Worth', value: fmt(summary.netWorth), change: '+8.3%', positive: true }
        ];

    return cards.map((card, index) => (
      <div key={index} className="summary-card">
        <div className="summary-card__header">
          <span className="summary-card__label">{card.label}</span>
          <span className={`summary-card__change ${card.positive ? 'positive' : 'negative'}`}>
            {card.change}
          </span>
        </div>
        <div className="summary-card__value">{card.value}</div>
        <div className="summary-card__sparkline">
          {/* Simple sparkline visualization */}
          <svg width="60" height="20" className="sparkline">
            <polyline
              fill="none"
              stroke={card.positive ? 'var(--color-success-500)' : 'var(--color-error-500)'}
              strokeWidth="2"
              points={generateSparklinePoints(card.positive)}
            />
          </svg>
        </div>
      </div>
    ));
  };

  // Generate sparkline points
  const generateSparklinePoints = (positive) => {
    const points = [];
    const baseY = positive ? 15 : 5;
    const amplitude = positive ? 5 : 10;
    
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * 60;
      const y = baseY + Math.sin(i * 0.8) * amplitude * (positive ? 1 : -1);
      points.push(`${x},${y}`);
    }
    
    return points.join(' ');
  };

  // Render account grid
  const renderAccountGrid = () => {
    return accounts.map(account => {
      const isExpanded = expandedAccounts?.has(account.id);
      const typeInfo = getAccountTypeInfo(account.accountType || account.type);
      const hasRichProfile = account.routingNumber || account.swiftCode || account.iban || account.branchName;
      
      return (
        <div
          key={account.id}
          className={`account-card ${selectedAccount === account.id ? 'selected' : ''}`}
          style={account._demo ? { opacity: 0.65 } : {}}
          onClick={() => setSelectedAccount(account.id === selectedAccount ? null : account.id)}
        >
          <div className="account-card__header">
            <div className="account-card__type-icon" style={{ backgroundColor: typeInfo.bgColor }}>
              <span style={{ color: typeInfo.color }}>{typeInfo.icon}</span>
            </div>
            <div className="account-card__info">
              <h3 className="account-card__name">{account.name}</h3>
              <span className="account-card__type">{typeInfo.icon} {(account.accountType || account.type || 'Unknown').charAt(0).toUpperCase() + (account.accountType || account.type || 'Unknown').slice(1)}</span>
            </div>
            {account._demo && (
              <span className="account-card__demo-badge">Demo</span>
            )}
          </div>
          
          <div className="account-card__balance">
            <span className="account-card__balance-label">Balance</span>
            <span className={`account-card__balance-value ${DEBT_TYPES.has(account.accountType || account.type) ? 'negative' : 'positive'}`}>
              {fmt(account.balance)}
            </span>
          </div>
          
          <div className="account-card__number">
            <span className="account-card__account-number">
              Account: {account.accountNumber}
            </span>
          </div>
          
          {/* Quick actions */}
          <div className="account-card__actions">
            <button
              type="button"
              className="account-card__action-btn"
              onClick={(e) => {
                e.stopPropagation();
                // Handle quick action
              }}
            >
              📊
            </button>
            <button
              type="button"
              className="account-card__action-btn"
              onClick={(e) => {
                e.stopPropagation();
                // Handle quick action
              }}
            >
              📄
            </button>
            {hasRichProfile && (
              <button
                type="button"
                className="account-card__action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleAccount(account.id);
                }}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            )}
          </div>
          
          {/* Rich profile details */}
          {isExpanded && hasRichProfile && (
            <div className="account-card__details">
              <div className="account-card__details-grid">
                {account.routingNumber && (
                  <div className="account-card__detail-item">
                    <span className="account-card__detail-label">Routing Number</span>
                    <span className="account-card__detail-value">{account.routingNumber}</span>
                  </div>
                )}
                {account.swiftCode && (
                  <div className="account-card__detail-item">
                    <span className="account-card__detail-label">SWIFT Code</span>
                    <span className="account-card__detail-value">{account.swiftCode}</span>
                  </div>
                )}
                {account.iban && (
                  <div className="account-card__detail-item">
                    <span className="account-card__detail-label">IBAN</span>
                    <span className="account-card__detail-value">{account.iban}</span>
                  </div>
                )}
                {account.branchName && (
                  <div className="account-card__detail-item">
                    <span className="account-card__detail-label">Branch</span>
                    <span className="account-card__detail-value">{account.branchName}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      );
    });
  };

  // Render account list view
  const renderAccountList = () => {
    return (
      <div className="account-list">
        {accounts.map(account => {
          const typeInfo = getAccountTypeInfo(account.accountType || account.type);
          const isExpanded = expandedAccounts?.has(account.id);
          
          return (
            <div
              key={account.id}
              className="account-list-item"
              style={account._demo ? { opacity: 0.65 } : {}}
            >
              <div className="account-list-item__header">
                <div className="account-list-item__icon" style={{ backgroundColor: typeInfo.bgColor }}>
                  <span style={{ color: typeInfo.color }}>{typeInfo.icon}</span>
                </div>
                <div className="account-list-item__info">
                  <h3 className="account-list-item__name">{account.name}</h3>
                  <span className="account-list-item__number">{account.accountNumber}</span>
                </div>
                <div className="account-list-item__balance">
                  <span className={`account-list-item__balance-value ${DEBT_TYPES.has(account.accountType || account.type) ? 'negative' : 'positive'}`}>
                    {fmt(account.balance)}
                  </span>
                </div>
                <button
                  type="button"
                  className="account-list-item__expand"
                  onClick={() => onToggleAccount(account.id)}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
              </div>
              
              {isExpanded && (
                <div className="account-list-item__details">
                  <div className="account-list-item__details-grid">
                    {account.routingNumber && (
                      <div className="account-list-item__detail-item">
                        <span>Routing Number</span>
                        <span>{account.routingNumber}</span>
                      </div>
                    )}
                    {account.swiftCode && (
                      <div className="account-list-item__detail-item">
                        <span>SWIFT Code</span>
                        <span>{account.swiftCode}</span>
                      </div>
                    )}
                    {account.iban && (
                      <div className="account-list-item__detail-item">
                        <span>IBAN</span>
                        <span>{account.iban}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="account-summary">
      <div className="account-summary__header">
        <div className="account-summary__title-section">
          <h2 className="account-summary__title">{verticalFeatures.title}</h2>
          <p className="account-summary__subtitle">
            {currentVertical === 'retail' && 'Track your store performance and financial metrics'}
            {currentVertical === 'workforce' && 'Monitor your workforce and compensation overview'}
            {currentVertical === 'banking' && 'Manage your accounts and track your financial health'}
          </p>
        </div>
        
        <div className="account-summary__actions">
          <div className="account-summary__view-toggle">
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              ⊞ Grid
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              ☰ List
            </button>
          </div>
        </div>
      </div>

      {/* Demo notice */}
      {isDemoMode && (
        <div className="account-summary__demo-notice">
          <span className="account-summary__demo-icon">ℹ️</span>
          <span className="account-summary__demo-text">
            Demo mode —{' '}
            <button type="button" onClick={onNavigateToLogin} className="account-summary__demo-link">
              sign in
            </button>{' '}
            to use your real accounts
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className="account-summary__cards">
        {renderSummaryCards()}
      </div>

      {/* Account breakdown */}
      <div className="account-summary__accounts-section">
        <div className="account-summary__accounts-header">
          <h3 className="account-summary__accounts-title">Account Breakdown</h3>
          <div className="account-summary__accounts-stats">
            <span className="account-summary__accounts-count">{summary.accountCount} accounts</span>
            <span className="account-summary__accounts-total">Total: {fmt(summary.totalAssets)}</span>
          </div>
        </div>
        
        {viewMode === 'grid' ? (
          <div className="accounts-grid">
            {renderAccountGrid()}
          </div>
        ) : (
          renderAccountList()
        )}
      </div>

      {/* Account type distribution */}
      <div className="account-summary__distribution">
        <h3 className="account-summary__distribution-title">Account Type Distribution</h3>
        <div className="account-summary__distribution-chart">
          {Object.entries(summary.accountTypes).map(([type, data]) => {
            const typeInfo = getAccountTypeInfo(type);
            const percentage = summary.totalAssets > 0 ? (data.total / summary.totalAssets) * 100 : 0;
            
            return (
              <div key={type} className="distribution-item">
                <div className="distribution-item__header">
                  <span className="distribution-item__icon">{typeInfo.icon}</span>
                  <span className="distribution-item__label">{type.charAt(0).toUpperCase() + type.slice(1)}</span>
                  <span className="distribution-item__count">({data.count})</span>
                </div>
                <div className="distribution-item__bar">
                  <div
                    className="distribution-item__fill"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: typeInfo.color
                    }}
                  />
                </div>
                <div className="distribution-item__value">{fmt(data.total)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default AccountSummary;
