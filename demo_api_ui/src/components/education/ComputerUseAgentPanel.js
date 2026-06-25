import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

const loopStageStyle = {
  flex: '1 1 150px',
  minWidth: 150,
  border: '1px solid rgba(0, 64, 128, 0.16)',
  borderRadius: 14,
  background: 'linear-gradient(180deg, #ffffff 0%, #f4f8fc 100%)',
  padding: '14px 16px',
  boxShadow: '0 10px 22px rgba(8, 30, 52, 0.06)',
};

const loopArrowStyle = {
  fontSize: 22,
  fontWeight: 700,
  color: '#0f5ea8',
  padding: '0 6px',
};

const compareTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
  marginTop: 12,
};

const cellStyle = {
  border: '1px solid #d7e1ea',
  padding: '10px 12px',
  verticalAlign: 'top',
  textAlign: 'left',
};

function TableCell({ children, header = false }) {
  return (
    <td
      style={{
        ...cellStyle,
        ...(header
          ? { background: '#f3f7fb', fontWeight: 700, color: '#183b56', width: '28%' }
          : null),
      }}
    >
      {children}
    </td>
  );
}

export default function ComputerUseAgentPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  const linkStyle = {
    border: '1px solid #c8d7e6',
    borderRadius: 999,
    background: '#f4f8fb',
    color: '#0b4f8a',
    cursor: 'pointer',
    padding: '8px 12px',
    fontWeight: 600,
  };

  const tabs = [
    {
      id: 'what',
      label: 'What is CUA?',
      content: (
        <>
          <p>
            <strong>Computer Use Agent (CUA)</strong> is an agent pattern where the model interacts with a user
            interface by observing screens and choosing actions such as clicking, typing, or navigating.
            Instead of calling a clean structured API, the agent reasons over what it can see on the screen and
            drives the interface step by step.
          </p>
          <p>
            This is useful when a system does not expose stable APIs or tool contracts, but it also increases
            fragility: the agent depends on screenshots, layout recognition, timing, and UI consistency.
          </p>
          <p>
            In practice, CUA behaves more like a careful robotic operator. It watches the screen, infers the next
            step, performs one action, then checks the new screen before continuing.
          </p>
        </>
      ),
    },
    {
      id: 'loop',
      label: 'How it works',
      content: (
        <>
          <p>
            A CUA usually runs in a loop: capture the current interface, analyze the visible state, choose a next
            action, perform it, then repeat until the task is complete.
          </p>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              margin: '18px 0',
            }}
          >
            <div style={loopStageStyle}>
              <strong>1. Screenshot capture</strong>
              <p style={{ marginBottom: 0 }}>
                The agent reads the visible page, dialog, or application state.
              </p>
            </div>
            <div style={loopArrowStyle}>→</div>
            <div style={loopStageStyle}>
              <strong>2. Vision analysis</strong>
              <p style={{ marginBottom: 0 }}>
                The model interprets buttons, fields, warnings, and layout clues.
              </p>
            </div>
            <div style={loopArrowStyle}>→</div>
            <div style={loopStageStyle}>
              <strong>3. Action decision</strong>
              <p style={{ marginBottom: 0 }}>
                It selects the next click, keystroke, or navigation step.
              </p>
            </div>
            <div style={loopArrowStyle}>→</div>
            <div style={loopStageStyle}>
              <strong>4. UI interaction</strong>
              <p style={{ marginBottom: 0 }}>
                The chosen action is executed, then the loop repeats on the updated screen.
              </p>
            </div>
          </div>

          <ul>
            <li>CUA can work across apps that were never designed for agents.</li>
            <li>It is slower and more brittle than structured tool calls.</li>
            <li>Small UI changes can break the agent&apos;s understanding of the page.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'compare',
      label: 'CUA vs MCP/tool-use',
      content: (
        <>
          <p>
            CUA and MCP/tool-use both help agents complete tasks, but they operate at very different layers of the
            system.
          </p>

          <table style={compareTableStyle}>
            <tbody>
              <tr>
                <TableCell header>Feature</TableCell>
                <TableCell header>CUA</TableCell>
                <TableCell header>MCP / tool-use</TableCell>
              </tr>
              <tr>
                <TableCell header>Interaction method</TableCell>
                <TableCell>Observes screens and manipulates UI controls.</TableCell>
                <TableCell>Calls named tools with structured inputs and outputs.</TableCell>
              </tr>
              <tr>
                <TableCell header>Requires vision</TableCell>
                <TableCell>Yes. The screen is part of the reasoning loop.</TableCell>
                <TableCell>No. The agent works from schemas and API/tool contracts.</TableCell>
              </tr>
              <tr>
                <TableCell header>API dependency</TableCell>
                <TableCell>Low. Can operate where only a UI exists.</TableCell>
                <TableCell>High. Needs explicit tool surfaces or APIs.</TableCell>
              </tr>
              <tr>
                <TableCell header>Reliability</TableCell>
                <TableCell>More fragile when layouts, labels, or timing change.</TableCell>
                <TableCell>More reliable because tool inputs and outputs are structured.</TableCell>
              </tr>
              <tr>
                <TableCell header>Security model</TableCell>
                <TableCell>Often inherits the risks of broad UI access and visual ambiguity.</TableCell>
                <TableCell>Can scope tools, permissions, audiences, and approvals more precisely.</TableCell>
              </tr>
              <tr>
                <TableCell header>Latency</TableCell>
                <TableCell>Higher because each step requires observe → reason → act → re-check.</TableCell>
                <TableCell>Lower when a single tool call performs the task directly.</TableCell>
              </tr>
            </tbody>
          </table>
        </>
      ),
    },
    {
      id: 'security',
      label: 'Security & trust',
      content: (
        <>
          <p>
            CUA raises a different trust question from tool-use: not only <em>what</em> the agent is allowed to do,
            but also whether it can safely interpret what it sees on a changing interface.
          </p>
          <ul>
            <li>
              <strong>Screen ambiguity:</strong> visual similarity can lead to clicking the wrong control.
            </li>
            <li>
              <strong>Scope ambiguity:</strong> UI access is often broader than a narrowly scoped API tool.
            </li>
            <li>
              <strong>Audit difficulty:</strong> replaying why an agent chose a UI action can be harder than auditing a
              typed tool call.
            </li>
            <li>
              <strong>Approval needs:</strong> higher-risk actions still benefit from human approval and step-up checks.
            </li>
          </ul>
          <p>
            For regulated workflows like banking, structured tool-use usually offers stronger least-privilege and
            clearer auditability than a screen-driving agent.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
            <button type="button" style={linkStyle} onClick={() => open(EDU.AGENT_GATEWAY, 'overview')}>
              See Agent Gateway
            </button>
            <button type="button" style={linkStyle} onClick={() => open(EDU.HUMAN_IN_LOOP, 'what')}>
              See Human-in-the-Loop
            </button>
            <button type="button" style={linkStyle} onClick={() => open(EDU.MCP_PROTOCOL, 'what')}>
              See MCP Protocol
            </button>
          </div>
        </>
      ),
    },
    {
      id: 'demo',
      label: 'In this demo',
      content: (
        <>
          <p>
            This demo uses <strong>MCP/tool-use</strong>, not browser-driving CUA. The agent talks to a controlled
            tool surface, the BFF keeps tokens server-side, and sensitive actions can trigger approval or step-up
            controls.
          </p>
          <p>
            That is a deliberate design choice. Banking workflows benefit from explicit tool contracts, token
            exchange boundaries, scoped permissions, and auditable server-side enforcement.
          </p>
          <p>
            CUA is still worth learning because it shows a different agent architecture: one that works through the
            interface itself. Understanding both patterns helps explain why this repo prefers MCP/tool-use for the
            trust-sensitive banking path.
          </p>
          <p>
            If you want to compare the trust boundaries directly, jump to Agent Gateway for audience + scope routing,
            Human-in-the-Loop for approval controls, and MCP Protocol for the structured tool surface used here.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Computer Use Agent (CUA)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}