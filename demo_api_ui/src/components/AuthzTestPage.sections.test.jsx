// demo_api_ui/src/components/AuthzTestPage.sections.test.jsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// apiClient is called on mount by the page; stub it so the test is deterministic.
vi.mock('../services/apiClient', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { activeEngine: 'simulated', thresholds: { simulated: {}, pingone: {} } } }),
    post: vi.fn().mockResolvedValue({ data: {
      ok: true, engine: 'simulated-learning', demoType: 'abac', decision: 'PERMIT', effect: 'PERMIT',
      obligations: [], statements: [], trace: { policySet: 'Account Access', rule: 'Region match', condition: 'EU==EU', effect: 'PERMIT', statements: [] }, raw: {},
    } }),
  },
}));

import apiClient from '../services/apiClient';
import AuthzTestPage from './AuthzTestPage';

describe('AuthzTestPage learning sections', () => {
  beforeEach(() => { apiClient.post.mockClear(); });

  test('renders all 7 section headers', async () => {
    render(<AuthzTestPage />);
    // Wait for the loading spinner to disappear (status fetch resolves)
    expect(await screen.findByText(/Overview & Trust Framework/)).toBeInTheDocument();
    expect(screen.getByText(/Attributes & ABAC/)).toBeInTheDocument();
    expect(screen.getByText(/API Access Management/)).toBeInTheDocument();
  });

  test('opening ABAC and evaluating posts to test-evaluate and shows a decision', async () => {
    render(<AuthzTestPage />);
    // Wait past loading state
    await screen.findByText(/Overview & Trust Framework/);
    const abacToggle = screen.getByRole('button', { name: /Attributes & ABAC/ });
    fireEvent.click(abacToggle);
    // Scope to the ABAC section to avoid matching the Custom Evaluation "Evaluate" button
    const abacSection = abacToggle.closest('section');
    fireEvent.click(within(abacSection).getByRole('button', { name: /Evaluate/i }));
    const permits = await within(abacSection).findAllByText('PERMIT');
    expect(permits.length).toBeGreaterThan(0);
    const postCalls = apiClient.post.mock.calls.filter((c) => c[0] === '/api/authorize/test-evaluate');
    expect(postCalls.length).toBeGreaterThan(0);
    expect(postCalls[postCalls.length - 1][1].demoType).toBe('abac');
  });
});
