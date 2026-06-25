import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventCard from '../EventCard';

function makeEvent(overrides = {}) {
  return {
    id: 'evt-1',
    type: 'user_request',
    timestamp: '2024-01-15T10:30:45.000Z',
    message: 'User asked about account balance',
    ...overrides,
  };
}

describe('EventCard', () => {
  describe('badge rendering', () => {
    const cases = [
      ['user_request', 'user request'],
      ['agent_thinking', 'agent thinking'],
      ['tool_call', 'tool call'],
      ['token_exchange', 'token exchange'],
      ['result', 'result'],
      ['error', 'error'],
    ];

    it.each(cases)('renders badge for type %s with label "%s"', (type, label) => {
      render(<EventCard event={makeEvent({ type })} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('renders badge for unknown type without crashing', () => {
      render(<EventCard event={makeEvent({ type: 'some_new_type' })} />);
      expect(screen.getByText('some new type')).toBeInTheDocument();
    });
  });

  describe('message', () => {
    it('renders the message text', () => {
      render(<EventCard event={makeEvent({ message: 'Hello world' })} />);
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
  });

  describe('timestamp', () => {
    it('renders a formatted time string from the ISO timestamp', () => {
      render(<EventCard event={makeEvent({ timestamp: '2024-01-15T10:30:45.000Z' })} />);
      // Just check that some time-like string appears — locale-dependent format
      const timeEl = document.querySelector('.ec-timestamp');
      expect(timeEl).not.toBeNull();
      expect(timeEl.textContent).toBeTruthy();
    });
  });

  describe('details expansion', () => {
    it('does not render a toggle when event has no details', () => {
      render(<EventCard event={makeEvent({ details: undefined })} />);
      expect(document.querySelector('.ec-toggle')).toBeNull();
    });

    it('renders a toggle when event has details', () => {
      render(<EventCard event={makeEvent({ details: { foo: 'bar' } })} />);
      expect(document.querySelector('.ec-toggle')).not.toBeNull();
    });

    it('details are hidden by default', () => {
      render(<EventCard event={makeEvent({ details: { foo: 'bar' } })} />);
      expect(document.querySelector('.ec-details')).toBeNull();
    });

    it('clicking the header expands details', async () => {
      render(<EventCard event={makeEvent({ details: { key: 'value' } })} />);
      const header = document.querySelector('.ec-header');
      await userEvent.click(header);
      expect(document.querySelector('.ec-details')).not.toBeNull();
      expect(screen.getByText(/"key": "value"/)).toBeInTheDocument();
    });

    it('clicking again collapses details', async () => {
      render(<EventCard event={makeEvent({ details: { x: 1 } })} />);
      const header = document.querySelector('.ec-header');
      await userEvent.click(header);
      expect(document.querySelector('.ec-details')).not.toBeNull();
      await userEvent.click(header);
      expect(document.querySelector('.ec-details')).toBeNull();
    });

    it('renders string details as-is', async () => {
      render(<EventCard event={makeEvent({ details: 'raw text' })} />);
      const header = document.querySelector('.ec-header');
      await userEvent.click(header);
      expect(screen.getByText('raw text')).toBeInTheDocument();
    });
  });

  describe('error styling', () => {
    it('adds error class for error type', () => {
      render(<EventCard event={makeEvent({ type: 'error', message: 'Something broke' })} />);
      expect(document.querySelector('.ec-card--error')).not.toBeNull();
    });

    it('does not add error class for non-error types', () => {
      render(<EventCard event={makeEvent({ type: 'result' })} />);
      expect(document.querySelector('.ec-card--error')).toBeNull();
    });
  });
});
