import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventStreamPanel from '../EventStreamPanel';

// ── Mock useDraggablePanel — not under test here ─────────────
vi.mock('../../hooks/useDraggablePanel', () => ({
  useDraggablePanel: () => ({
    pos: { x: 100, y: 100 },
    size: { w: 420, h: 480 },
    handleDragStart: vi.fn(),
    handleResizeStart: vi.fn(),
    createResizeHandler: vi.fn(() => vi.fn()),
  }),
}));

// ── Mock EventStreamContext ──────────────────────────────────
let _mockCtx = null;

vi.mock('../../context/EventStreamContext', () => ({
  useEventStream: () => _mockCtx,
}));

function baseCtx(overrides = {}) {
  return {
    events: [],
    mode: 'embedded',
    autoScrollEnabled: true,
    clearHistory: vi.fn(),
    setMode: vi.fn(),
    pauseAutoScroll: vi.fn(),
    resumeAutoScroll: vi.fn(),
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    id: `evt-${Math.random()}`,
    type: 'user_request',
    timestamp: new Date().toISOString(),
    message: 'Test event message',
    ...overrides,
  };
}

describe('EventStreamPanel', () => {
  describe('empty state', () => {
    it('shows empty state message when no events', () => {
      _mockCtx = baseCtx();
      render(<EventStreamPanel />);
      expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
    });

    it('does not show empty state when events are present', () => {
      _mockCtx = baseCtx({ events: [makeEvent()] });
      render(<EventStreamPanel />);
      expect(screen.queryByText(/no events yet/i)).not.toBeInTheDocument();
    });
  });

  describe('mode switching', () => {
    it('renders the mode selector dropdown', () => {
      _mockCtx = baseCtx();
      render(<EventStreamPanel />);
      expect(screen.getByRole('combobox', { name: /panel mode/i })).toBeInTheDocument();
    });

    it('calls setMode when a different mode is selected', async () => {
      const setMode = vi.fn();
      _mockCtx = baseCtx({ setMode });
      render(<EventStreamPanel />);
      const select = screen.getByRole('combobox', { name: /panel mode/i });
      await userEvent.selectOptions(select, 'float');
      expect(setMode).toHaveBeenCalledWith('float');
    });

    it('applies panel-mode-embedded class in embedded mode', () => {
      _mockCtx = baseCtx({ mode: 'embedded' });
      render(<EventStreamPanel />);
      expect(screen.getByTestId('esp-panel')).toHaveClass('panel-mode-embedded');
    });

    it('applies panel-mode-float class in float mode', () => {
      _mockCtx = baseCtx({ mode: 'float' });
      render(<EventStreamPanel />);
      expect(screen.getByTestId('esp-panel')).toHaveClass('panel-mode-float');
    });

    it('applies panel-mode-bottom class in bottom mode', () => {
      _mockCtx = baseCtx({ mode: 'bottom' });
      render(<EventStreamPanel />);
      expect(screen.getByTestId('esp-panel')).toHaveClass('panel-mode-bottom');
    });
  });

  describe('clear button', () => {
    it('calls clearHistory when clear button is clicked', async () => {
      const clearHistory = vi.fn();
      _mockCtx = baseCtx({ clearHistory });
      render(<EventStreamPanel />);
      await userEvent.click(screen.getByLabelText('Clear events'));
      expect(clearHistory).toHaveBeenCalledTimes(1);
    });
  });

  describe('close button', () => {
    it('does not render a close button when onClose is not provided', () => {
      _mockCtx = baseCtx();
      render(<EventStreamPanel />);
      expect(screen.queryByLabelText('Close panel')).not.toBeInTheDocument();
    });

    it('renders a close button when onClose is provided', () => {
      _mockCtx = baseCtx();
      const onClose = vi.fn();
      render(<EventStreamPanel onClose={onClose} />);
      expect(screen.getByLabelText('Close panel')).toBeInTheDocument();
    });

    it('calls onClose when the close button is clicked', async () => {
      const onClose = vi.fn();
      _mockCtx = baseCtx();
      render(<EventStreamPanel onClose={onClose} />);
      await userEvent.click(screen.getByLabelText('Close panel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('event rendering', () => {
    it('renders event messages', () => {
      _mockCtx = baseCtx({
        events: [makeEvent({ message: 'Agent is thinking...' })],
      });
      render(<EventStreamPanel />);
      expect(screen.getByText('Agent is thinking...')).toBeInTheDocument();
    });

    it('renders multiple events', () => {
      _mockCtx = baseCtx({
        events: [
          makeEvent({ id: 'e1', message: 'First event' }),
          makeEvent({ id: 'e2', message: 'Second event' }),
        ],
      });
      render(<EventStreamPanel />);
      expect(screen.getByText('First event')).toBeInTheDocument();
      expect(screen.getByText('Second event')).toBeInTheDocument();
    });
  });

  describe('request dividers', () => {
    it('renders a request divider when consecutive events share a requestId', () => {
      _mockCtx = baseCtx({
        events: [
          makeEvent({ id: 'e1', requestId: 'req-123', message: 'Event one' }),
          makeEvent({ id: 'e2', requestId: 'req-123', message: 'Event two' }),
        ],
      });
      render(<EventStreamPanel />);
      expect(screen.getByText('Request req-123')).toBeInTheDocument();
    });

    it('renders separate dividers for different requestIds', () => {
      _mockCtx = baseCtx({
        events: [
          makeEvent({ id: 'e1', requestId: 'req-A', message: 'Event A' }),
          makeEvent({ id: 'e2', requestId: 'req-B', message: 'Event B' }),
        ],
      });
      render(<EventStreamPanel />);
      expect(screen.getByText('Request req-A')).toBeInTheDocument();
      expect(screen.getByText('Request req-B')).toBeInTheDocument();
    });

    it('does not render a divider when events have no requestId', () => {
      _mockCtx = baseCtx({
        events: [
          makeEvent({ id: 'e1', message: 'Event one' }),
          makeEvent({ id: 'e2', message: 'Event two' }),
        ],
      });
      render(<EventStreamPanel />);
      expect(document.querySelector('.esp-divider')).toBeNull();
    });
  });

  describe('auto-scroll', () => {
    it('pauses auto-scroll when user scrolls up', async () => {
      const pauseAutoScroll = vi.fn();
      _mockCtx = baseCtx({
        events: [makeEvent()],
        autoScrollEnabled: true,
        pauseAutoScroll,
      });
      render(<EventStreamPanel />);
      const body = screen.getByTestId('esp-body');

      // Simulate scrolled-up state (scrollHeight > scrollTop + clientHeight + threshold)
      Object.defineProperty(body, 'scrollHeight', { value: 500, configurable: true });
      Object.defineProperty(body, 'scrollTop', { value: 0, configurable: true });
      Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });

      act(() => {
        body.dispatchEvent(new Event('scroll'));
      });

      expect(pauseAutoScroll).toHaveBeenCalled();
    });

    it('resumes auto-scroll when user scrolls back to bottom', async () => {
      const resumeAutoScroll = vi.fn();
      _mockCtx = baseCtx({
        events: [makeEvent()],
        autoScrollEnabled: false,
        resumeAutoScroll,
      });
      render(<EventStreamPanel />);
      const body = screen.getByTestId('esp-body');

      // Simulate at-bottom state
      Object.defineProperty(body, 'scrollHeight', { value: 200, configurable: true });
      Object.defineProperty(body, 'scrollTop', { value: 180, configurable: true });
      Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });

      act(() => {
        body.dispatchEvent(new Event('scroll'));
      });

      expect(resumeAutoScroll).toHaveBeenCalled();
    });
  });
});
