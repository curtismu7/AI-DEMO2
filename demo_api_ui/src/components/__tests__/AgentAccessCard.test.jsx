import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AgentAccessCard from '../AgentAccessCard';

vi.mock('../../services/bffAxios', () => ({
  default: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

import bffAxios from '../../services/bffAxios';

describe('AgentAccessCard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows "No agent access" when authorized is false', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: false, enforced: false } });
    render(<AgentAccessCard />);
    await screen.findByText(/no agent access/i);
    expect(screen.queryByText(/revoke/i)).toBeNull();
  });

  it('shows Revoke and Revoke Immediately when authorized is true', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: true, enforced: true } });
    render(<AgentAccessCard />);
    await screen.findByText(/revoke immediately/i);
    expect(screen.getByText(/^revoke$/i)).toBeTruthy();
  });

  it('soft revoke calls DELETE / and updates card to inactive', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: true, enforced: true } });
    bffAxios.delete.mockResolvedValue({ data: { ok: true, revoked: 'soft' } });
    render(<AgentAccessCard />);
    await screen.findByText(/^revoke$/i);
    fireEvent.click(screen.getByText(/^revoke$/i));
    // confirm dialog
    await screen.findByText(/confirm revoke/i);
    fireEvent.click(screen.getByText(/confirm revoke/i));
    await waitFor(() => expect(bffAxios.delete).toHaveBeenCalledWith('/api/agent-authorization'));
    await screen.findByText(/no agent access/i);
  });

  it('hard revoke shows blocking modal on sessionClear', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: true, enforced: true } });
    bffAxios.delete.mockResolvedValue({ data: { ok: true, revoked: 'hard', sessionClear: true } });
    render(<AgentAccessCard />);
    await screen.findByText(/revoke immediately/i);
    fireEvent.click(screen.getByText(/revoke immediately/i));
    await screen.findByText(/confirm revoke immediately/i);
    fireEvent.click(screen.getByText(/confirm revoke immediately/i));
    await waitFor(() => expect(bffAxios.delete).toHaveBeenCalledWith('/api/agent-authorization/hard'));
    await screen.findByText(/agent access revoked/i);
    expect(screen.getByText(/log in again/i)).toBeTruthy();
  });

  it('soft revoke shows error message when API call fails', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: true, enforced: true } });
    bffAxios.delete.mockRejectedValue(new Error('Network error'));
    render(<AgentAccessCard />);
    await screen.findByText(/^revoke$/i);
    fireEvent.click(screen.getByText(/^revoke$/i));
    await screen.findByText(/confirm revoke/i);
    fireEvent.click(screen.getByText(/confirm revoke/i));
    await screen.findByText(/failed to revoke access/i);
  });

  it('hard revoke shows error message when API call fails', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: true, enforced: true } });
    bffAxios.delete.mockRejectedValue(new Error('Network error'));
    render(<AgentAccessCard />);
    await screen.findByText(/revoke immediately/i);
    fireEvent.click(screen.getByText(/revoke immediately/i));
    await screen.findByText(/confirm revoke immediately/i);
    fireEvent.click(screen.getByText(/confirm revoke immediately/i));
    await screen.findByText(/failed to revoke access/i);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
