// demo_api_ui/src/components/PresenterHealthDot.test.jsx
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/cachedStatusService', () => ({
  getCachedStatus: vi.fn(),
}));

import { getCachedStatus } from '../services/cachedStatusService';
import PresenterHealthDot from './PresenterHealthDot';

const allUp = {
  services: {
    mcp_gateway: { up: true },
    mcp_server: { up: true },
    hitl_service: { up: true },
    agent_service: { up: true, checks: { env: 'ok', prompts: 'primary' } },
    llm_proxy: { up: true },
  },
};

describe('PresenterHealthDot', () => {
  beforeEach(() => getCachedStatus.mockReset());

  it('renders green when all services are healthy', async () => {
    getCachedStatus.mockResolvedValue(allUp);
    const { container } = render(<PresenterHealthDot />);
    await waitFor(() => expect(container.querySelector('.phd-dot.phd-ok')).toBeTruthy());
  });

  it('renders red when an LLM-path service is down', async () => {
    getCachedStatus.mockResolvedValue({
      services: { ...allUp.services, llm_proxy: { up: false, error: 'ECONNREFUSED' } },
    });
    const { container } = render(<PresenterHealthDot />);
    await waitFor(() => expect(container.querySelector('.phd-dot.phd-err')).toBeTruthy());
    expect(container.querySelector('.phd-dot').title).toContain('llm_proxy');
  });

  it('renders amber when prompts are degraded', async () => {
    getCachedStatus.mockResolvedValue({
      services: {
        ...allUp.services,
        agent_service: { up: true, checks: { env: 'ok', prompts: 'inline_fallback' } },
      },
    });
    const { container } = render(<PresenterHealthDot />);
    await waitFor(() => expect(container.querySelector('.phd-dot.phd-warn')).toBeTruthy());
  });

  it('renders red when the status endpoint itself is unreachable', async () => {
    getCachedStatus.mockRejectedValueOnce(new Error('network'));
    const { container } = render(<PresenterHealthDot />);
    await waitFor(() => expect(container.querySelector('.phd-dot.phd-err')).toBeTruthy());
  });
});
