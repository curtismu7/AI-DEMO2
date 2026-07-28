import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../DemoScriptLauncher.css', () => ({}), { virtual: true });

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// Isolate the launcher from DraggableModal's drag/resize/pop-out plumbing —
// same pattern used by AgentConsentModal.test.jsx, GatewayConsentModal.test.jsx,
// FidoStepUpModal.test.jsx, ClaimDetailsModal.test.jsx, CibaApprovalPage.test.jsx.
vi.mock('../DraggableModal', () => ({
  default: ({ children, footer, title, isOpen }) =>
    isOpen ? (
      <div>
        <div data-testid="modal-title">{title}</div>
        {children}
        <div data-testid="modal-footer">{footer}</div>
      </div>
    ) : null,
}));

import DemoScriptLauncher from '../DemoScriptLauncher';

// Minimal BroadcastChannel spy: captures every instance's `message` listener
// registration so a test can invoke it directly, exactly like a real
// `postMessage` from the other end of the channel would.
class TestBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.listeners = [];
    TestBroadcastChannel.instances.push(this);
  }
  postMessage() {}
  addEventListener(type, handler) {
    this.listeners.push([type, handler]);
  }
  removeEventListener(type, handler) {
    this.listeners = this.listeners.filter(([t, h]) => t !== type || h !== handler);
  }
  close() {}
}
TestBroadcastChannel.instances = [];

let originalBroadcastChannel;

beforeEach(() => {
  originalBroadcastChannel = global.BroadcastChannel;
  TestBroadcastChannel.instances = [];
  global.BroadcastChannel = TestBroadcastChannel;
});

afterEach(() => {
  global.BroadcastChannel = originalBroadcastChannel;
});

/** Render the launcher with the teleprompter panel open. */
function openLauncher() {
  const utils = render(<DemoScriptLauncher />);
  fireEvent.click(screen.getByText('Demo Script'));
  return utils;
}

/** The `message` listener the launcher registered on its own channel. */
function messageHandler() {
  const channel = TestBroadcastChannel.instances[TestBroadcastChannel.instances.length - 1];
  const entry = channel.listeners.find(([type]) => type === 'message');
  return entry ? entry[1] : undefined;
}

describe('DemoScriptLauncher — teleprompter beat highlight', () => {
  it('highlights the beat matching a select message from the workbench', () => {
    const { container } = openLauncher();
    const onMessage = messageHandler();
    expect(onMessage).toBeInstanceOf(Function);

    act(() => {
      onMessage({ data: { type: 'select', ucId: 'UC1' } });
    });

    const active = container.querySelector('.dsl-beat--active');
    expect(active).not.toBeNull();
    expect(active).toHaveTextContent('show my balance');
  });

  it('ignores a run message and leaves no beat active', () => {
    const { container } = openLauncher();
    const onMessage = messageHandler();

    act(() => {
      onMessage({ data: { type: 'run', ucId: 'UC1' } });
    });

    expect(container.querySelector('.dsl-beat--active')).toBeNull();
  });
});
