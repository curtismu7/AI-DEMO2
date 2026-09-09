// banking_api_ui/src/components/shared/__tests__/SpinnerHost.knobs.test.jsx
/**
 * SpinnerHost used to hardcode its variant, size, dark card and feed. They now
 * come from configStore via useAppFlags (/configure → Appearance), and the risk
 * that introduces is a knob that silently stops being read — the overlay would
 * still render, just ignoring the setting, which no other test would catch.
 */
import { render, screen } from '@testing-library/react';
import SpinnerHost from '../SpinnerHost';

const flags = vi.fn();
vi.mock('../../../hooks/useAppFlags', () => ({
  useAppFlags: () => ({ appFlags: flags() }),
}));
vi.mock('../../../context/SpinnerContext', () => ({
  useSpinner: () => ({ visible: true, message: 'Working…', color: null, endpoint: null }),
}));
vi.mock('../../../services/spinnerActivityService', () => ({
  spinnerActivity: {
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
    getEvents: () => [{ id: 1, icon: '·', timeDelta: '0s', message: 'seeded event' }],
  },
}));

const DEFAULTS = {
  spinnerVariant: 'neural',
  spinnerSize: 88,
  spinnerAccent: '',
  spinnerDarkCard: true,
  spinnerActivityFeed: true,
};
const withFlags = (over = {}) => flags.mockReturnValue({ ...DEFAULTS, ...over });
const card = () => document.querySelector('.lo-card');

describe('SpinnerHost reads its knobs from config', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--spinner-accent');
  });

  it('defaults reproduce the pre-knob overlay: neural, 88px, dark card', () => {
    withFlags();
    render(<SpinnerHost />);

    expect(document.querySelector('.ns').style.getPropertyValue('--ns-size')).toBe('88px');
    expect(card().className).toContain('lo-card--dark');
    expect(document.querySelector('.lo-spinner')).toBeNull();
    // Paired with the feed-off case below: without this the toggle test would
    // pass just as well against a feed that never renders at all.
    expect(screen.getByText('seeded event')).toBeInTheDocument();
  });

  it('size flows through to the spinner', () => {
    withFlags({ spinnerSize: 120 });
    render(<SpinnerHost />);

    expect(document.querySelector('.ns').style.getPropertyValue('--ns-size')).toBe('120px');
  });

  it('classic swaps in the border ring and drops the dark card', () => {
    withFlags({ spinnerVariant: 'classic' });
    render(<SpinnerHost />);

    expect(document.querySelector('.lo-spinner')).not.toBeNull();
    expect(document.querySelector('.ns')).toBeNull();
    expect(card().className).not.toContain('lo-card--dark');
  });

  it('dark card off gives the white card back, still neural', () => {
    withFlags({ spinnerDarkCard: false });
    render(<SpinnerHost />);

    expect(card().className).not.toContain('lo-card--dark');
    expect(document.querySelector('.ns')).not.toBeNull();
  });

  // The accent cannot be a prop (NeuralSpinner refuses inline colour), so it
  // travels as a :root custom property the stylesheet reads through.
  it('an accent lands on :root and on the card border; empty clears it', () => {
    withFlags({ spinnerAccent: '#059669' });
    const { unmount } = render(<SpinnerHost />);

    expect(document.documentElement.style.getPropertyValue('--spinner-accent')).toBe('#059669');
    expect(card().style.borderTopColor).toBe('rgb(5, 150, 105)');
    unmount();

    withFlags({ spinnerAccent: '' });
    render(<SpinnerHost />);
    expect(document.documentElement.style.getPropertyValue('--spinner-accent')).toBe('');
  });

  it('the feed toggle hides the activity list without stopping the overlay', () => {
    withFlags({ spinnerActivityFeed: false });
    render(<SpinnerHost />);

    expect(screen.queryByText('seeded event')).toBeNull();
    expect(document.querySelector('.ns')).not.toBeNull();
  });
});
