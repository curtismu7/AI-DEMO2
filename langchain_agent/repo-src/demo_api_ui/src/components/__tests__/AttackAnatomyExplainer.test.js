/**
 * AttackAnatomyExplainer — vitest component tests
 * Plan A · Phase A7.1 · Task 3
 */
import { render, screen } from '@testing-library/react';
import AttackAnatomyExplainer from '../AttackAnatomyExplainer';

// ── Fixtures ──────────────────────────────────────────────────────────────

const mockUcEntry = {
  title: 'Wrong / insufficient scope',
  useCaseId: 'insufficient-scope',
  track: 'attacks',
  buyerStory: 'An agent with the wrong scope can read or write data it was never meant to touch.',
  pingOneSolution: 'MCP server validates required scopes; gateway returns 403 insufficient_scope.',
  pingOneSolutionShort: 'Scope check at MCP server and gateway',
  whatToSay: 'Scope mismatch blocked at the gateway — not theater.',
  expectedOutcome: 'DENY_403',
  owasp: { threats: ['T2', 'T3'], sections: ['§5.1'] },
  codeRefs: [],
  maturity: 'works',
  trigger: { type: 'attack', sim: 'insufficient-scope' },
};

const mockSimResult = {
  sim: 'insufficient-scope',
  status: 403,
  errorCode: 'insufficient_scope',
  reason: 'Token lacks required scope: write',
  tokenChainEvents: [],
  useCaseId: 'insufficient-scope',
};

// ── Tests ─────────────────────────────────────────────────────────────────

test('renders nothing when simResult is null', () => {
  const { container } = render(
    <AttackAnatomyExplainer ucEntry={mockUcEntry} simResult={null} />
  );
  expect(container.firstChild).toBeNull();
});

test('renders nothing when ucEntry is null', () => {
  const { container } = render(
    <AttackAnatomyExplainer ucEntry={null} simResult={mockSimResult} />
  );
  expect(container.firstChild).toBeNull();
});

test('renders all 4 rows with correct fields from fixture', () => {
  render(<AttackAnatomyExplainer ucEntry={mockUcEntry} simResult={mockSimResult} />);

  // Title contains the UC title
  expect(screen.getByText(/Wrong \/ insufficient scope/)).toBeInTheDocument();

  // Row 1 + Row 3 both render buyerStory (v1: "Without PingOne" reuses the same text)
  const buyerStoryEls = screen.getAllByText(/An agent with the wrong scope/);
  expect(buyerStoryEls.length).toBeGreaterThanOrEqual(1);

  // Row 2 — errorCode appears in both row body and footer; at least one must exist
  expect(screen.getAllByText('insufficient_scope').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Token lacks required scope: write')).toBeInTheDocument();

  // Row 3 — Without PingOne (uses buyerStory text for v1)
  // The row label itself must be present
  expect(screen.getByText('Without PingOne')).toBeInTheDocument();

  // Row 4 — pingOneSolution
  expect(screen.getByText(/MCP server validates required scopes/)).toBeInTheDocument();

  // Footer — HTTP status
  expect(screen.getByText('403')).toBeInTheDocument();
});

test('OWASP chip present when owasp.threats is non-empty', () => {
  render(<AttackAnatomyExplainer ucEntry={mockUcEntry} simResult={mockSimResult} />);
  expect(screen.getByText(/OWASP ASI/)).toBeInTheDocument();
});

test('OWASP chip absent when owasp is empty object', () => {
  const ucNoOwasp = { ...mockUcEntry, owasp: {} };
  render(<AttackAnatomyExplainer ucEntry={ucNoOwasp} simResult={mockSimResult} />);
  expect(screen.queryByText(/OWASP ASI/)).toBeNull();
});

test('OWASP chip absent when owasp is undefined', () => {
  const ucNoOwasp = { ...mockUcEntry, owasp: undefined };
  render(<AttackAnatomyExplainer ucEntry={ucNoOwasp} simResult={mockSimResult} />);
  expect(screen.queryByText(/OWASP ASI/)).toBeNull();
});
