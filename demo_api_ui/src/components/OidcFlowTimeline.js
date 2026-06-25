/**
 * Phase 266 audit (2026-05-11): this timeline covers the OIDC login flow only;
 * the 3-path credential divergence is documented in AgentFlowDiagramPanel.js and
 * ArchitectureTokenFlowPage.js. No changes required here.
 */

/**
 * OidcFlowTimeline Component
 * Displays a vertical timeline of OIDC flow milestones
 * Shows: OIDC login → token exchange → MCP tool calls → backend operations
 *
 * Each milestone displays:
 * - Milestone name and description
 * - Timestamp
 * - Status (pending/active/done/error) with icon
 * - Details (exchange path, tool name, operation info)
 */

import React from 'react';
import { useFlowMilestones } from '../context/useFlowMilestones';

import '../styles/OidcFlowTimeline.css';
import TokenStateIndicator from './TokenStateIndicator';
import BackendOperationIndicator from './BackendOperationIndicator';

const MILESTONE_CONFIG = {
  oidc_login: {
    label: 'OIDC Authentication',
    icon: '🔐',
    color: '#FF6B35'
  },
  exchange_start: {
    label: 'Token Exchange',
    icon: '↔️',
    color: '#F7931E'
  },
  exchange_complete: {
    label: 'Exchange Complete',
    icon: '✓',
    color: '#38A169'
  },
  mcp_tool_call: {
    label: 'MCP Tool Call',
    icon: '⚙️',
    color: '#4299E1'
  },
  backend_operation: {
    label: 'Backend Operation',
    icon: '📡',
    color: '#9F7AEA'
  },
  flow_complete: {
    label: 'Flow Complete',
    icon: '🎉',
    color: '#38A169'
  }
};

function StatusBadge({ status, error }) {
  const statusConfig = {
    pending: {
      icon: '⏳',
      className: 'oidt-badge-pending',
      label: 'Pending'
    },
    active: {
      icon: '⟳',
      className: 'oidt-badge-active',
      label: 'In Progress'
    },
    done: {
      icon: '✓',
      className: 'oidt-badge-done',
      label: 'Complete'
    },
    error: {
      icon: '✕',
      className: 'oidt-badge-error',
      label: `Error: ${error || 'Unknown'}`
    }
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <div className={`oidt-status-badge ${config.className}`} title={config.label}>
      <span className="oidt-status-icon">{config.icon}</span>
      <span className="oidt-status-text">{config.label}</span>
    </div>
  );
}

function MilestoneRow({ milestone, index, total }) {
  const config = MILESTONE_CONFIG[milestone.type] || {};
  const isLast = index === total - 1;

  return (
    <div className="oidt-milestone-row" key={milestone.id}>
      {/* Timeline dot and line */}
      <div className="oidt-timeline-left">
        <div
          className="oidt-timeline-dot"
          style={{ backgroundColor: config.color }}
          title={config.label}
        >
          <span className="oidt-timeline-icon">{config.icon}</span>
        </div>
        {!isLast && <div className="oidt-timeline-line"></div>}
      </div>

      {/* Milestone content */}
      <div className="oidt-milestone-content">
        <div className="oidt-milestone-header">
          <h4 className="oidt-milestone-name">
            {milestone.details?.exchangePath && (
              <span className="oidt-exchange-badge">
                {milestone.details.exchangePath}
              </span>
            )}
            {config.label}
          </h4>
          <div className="oidt-milestone-header-right">
            {/* Token state indicator (Plan 02) */}
            {milestone.details?.token && (
              <TokenStateIndicator token={milestone.details.token} compact />
            )}
            <time className="oidt-milestone-time">
              {new Date(milestone.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
            </time>
          </div>
        </div>

        {/* Additional details */}
        {milestone.details && (
          <div className="oidt-milestone-details">
            {milestone.details.toolName && (
              <div className="oidt-detail-item">
                Tool: <code>{milestone.details.toolName}</code>
              </div>
            )}
            {milestone.details.operationName && (
              <div className="oidt-detail-item">
                Operation: <code>{milestone.details.operationName}</code>
              </div>
            )}
            {milestone.details.errorMsg && (
              <div className="oidt-detail-item oidt-error-msg">
                {milestone.details.errorMsg}
              </div>
            )}
          </div>
        )}

        {/* Status badge */}
        <div className="oidt-milestone-status">
          <StatusBadge
            status={milestone.status}
            error={milestone.details?.errorMsg}
          />
        </div>

        {/* Backend operations (Plan 03) — shown under mcp_tool_call milestones */}
        {milestone.type === 'mcp_tool_call' && milestone.details?.backendOperations?.length > 0 && (
          <div className="oidt-backend-ops">
            {milestone.details.backendOperations.map((op) => (
              <BackendOperationIndicator key={op.id || op.endpoint} operation={op} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function OidcFlowTimeline({ className = '' }) {
  const { milestones, initialized } = useFlowMilestones();

  if (!initialized) {
    return <div className={`oidt-container ${className}`}>Loading...</div>;
  }

  if (milestones.length === 0) {
    return (
      <div className={`oidt-container oidt-empty ${className}`}>
        <p className="oidt-empty-state">
          ℹ️ No flow milestones yet. Start an agent action to see the OAuth flow timeline.
        </p>
      </div>
    );
  }

  return (
    <div className={`oidt-container ${className}`}>
      <div className="oidt-header">
        <h3 className="oidt-title">OAuth Flow Timeline</h3>
        <p className="oidt-subtitle">{milestones.length} milestone(s)</p>
      </div>
      <div className="oidt-timeline">
        {milestones.map((milestone, index) => (
          <MilestoneRow
            key={milestone.id}
            milestone={milestone}
            index={index}
            total={milestones.length}
          />
        ))}
      </div>
    </div>
  );
}
