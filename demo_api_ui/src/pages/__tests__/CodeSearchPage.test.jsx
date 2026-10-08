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
