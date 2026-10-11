import { render, screen } from '@testing-library/react';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { CodeSearchPage } from '../CodeSearchPage';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: async () => ({ codebases: [] }),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('shows the protected RAG authorization flow and denied retrieval branch', () => {
  render(<CodeSearchPage />);

  expect(screen.getByRole('heading', { name: 'Protected RAG' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /retrieval authorization flow/i })).toBeInTheDocument();
  expect(screen.getByText(/Agent Privilege inspects the request/i)).toBeInTheDocument();
  expect(screen.getByText(/PingOne Authorize permits retrieval/i)).toBeInTheDocument();
  expect(screen.getByText(/retrieval denied/i)).toBeInTheDocument();
  expect(screen.getByText(/grounded answer with citations/i)).toBeInTheDocument();
});

// E5 remainder: the page header uses the shared HeroSection (avatar "PR", the
// green code-search variant) like the other Exploring pages, and the theme
// toggle moves into the hero row the way OAuth Academy does.
test('renders the shared hero with the PR avatar and green code-search variant', () => {
  const { container } = render(<CodeSearchPage />);

  expect(screen.getByText('PR')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Protected RAG' })).toBeInTheDocument();
  // The shared hero carries the code-search variant's gradient (HERO_VARIANTS['code-search']).
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- CSS-class/gradient assertions are structural
  expect(container.querySelector('.hero-section')).not.toBeNull();
  // the hand-rolled banner is gone
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting a removed class
  expect(container.querySelector('.protected-rag-banner')).toBeNull();
});
