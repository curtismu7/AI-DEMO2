// demo_api_ui/src/components/ActivityLogPage.js
import ActivityLogPanel from './ActivityLogPanel';

const wrapStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  padding: '24px',
  flex: 1,
  minHeight: 0,
  background: '#f1f5f9',
};

const cardStyle = {
  width: '700px',
  height: '720px',
  maxWidth: '100%',
  maxHeight: 'calc(100vh - 80px)',
  display: 'flex',
  flexDirection: 'column',
  background: '#ffffff',
  borderRadius: '10px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.13)',
  overflow: 'hidden',
};

const headerStyle = {
  padding: '12px 16px 10px',
  borderBottom: '1px solid #e2e8f0',
  flexShrink: 0,
};

const titleStyle = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#0f172a',
  margin: 0,
};

const subtitleStyle = {
  fontSize: '11px',
  color: '#64748b',
  marginTop: '2px',
};

export default function ActivityLogPage() {
  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <p style={titleStyle}>Activity Log</p>
          <p style={subtitleStyle}>
            Live event stream — oauth · mcp · delegation · hitl · token_exchange · gateway_path · and more
          </p>
        </div>
        <ActivityLogPanel enabled />
      </div>
    </div>
  );
}
