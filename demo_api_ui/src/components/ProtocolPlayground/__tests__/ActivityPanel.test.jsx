import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import ActivityPanel from '../ActivityPanel';

describe('ActivityPanel — sign-in prompt on 401', () => {
  test('shows a Sign in link when a step result is a 401', () => {
    render(
      <ActivityPanel
        results={[{ stepId: 'step-1', response: { status: 401, body: {} } }]}
        error="Missing value for :authReqId — the step that provides it did not complete successfully."
      />
    );

    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/api/auth/oauth/user/login?return_to=/protocol-playground');
  });

  test('does not show a Sign in link for a non-401 error', () => {
    render(
      <ActivityPanel
        results={[{ stepId: 'step-1', response: { status: 500, body: {} } }]}
        error="Backend error"
      />
    );

    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  test('does not show a Sign in link when there is no error', () => {
    render(
      <ActivityPanel
        results={[{ stepId: 'step-1', response: { status: 401, body: {} } }]}
        error={null}
      />
    );

    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
