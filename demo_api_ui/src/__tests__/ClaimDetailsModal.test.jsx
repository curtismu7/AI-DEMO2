import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import '@testing-library/jest-dom'; // eslint-disable-line import/no-unresolved

// Mock CSS imports
vi.mock('../styles/TokenChainRedesign.css', () => ({}), { virtual: true });
vi.mock('../components/DraggableModal', () => ({
  default: ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;
    return (
      <div data-testid="draggable-modal">
        <h2>{title}</h2>
        {children}
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
}));

import ClaimDetailsModal from '../components/ClaimDetailsModal';

describe('ClaimDetailsModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ClaimDetailsModal isOpen={false} tokenType="user" onClose={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when isOpen is true', () => {
    render(
      <ClaimDetailsModal isOpen={true} tokenType="user" onClose={() => {}} />
    );
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });

  describe('User Token Claims', () => {
    it('displays correct title for user token type', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="user" onClose={() => {}} />
      );
      expect(screen.getByText('User Token Claims')).toBeInTheDocument();
    });

    it('renders all user token claims', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="user" onClose={() => {}} />
      );
      expect(screen.getByText('sub')).toBeInTheDocument();
      expect(screen.getByText('iss')).toBeInTheDocument();
      expect(screen.getByText('aud')).toBeInTheDocument();
      expect(screen.getByText('exp')).toBeInTheDocument();
      expect(screen.getByText('iat')).toBeInTheDocument();
      expect(screen.getByText('scope')).toBeInTheDocument();
      expect(screen.getByText('client_id')).toBeInTheDocument();
      expect(screen.getByText('acr')).toBeInTheDocument();
      expect(screen.getByText('amr')).toBeInTheDocument();
      expect(screen.getByText('auth_time')).toBeInTheDocument();
    });

    it('displays claim values for user token', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="user" onClose={() => {}} />
      );
      expect(screen.getByText('user-12345')).toBeInTheDocument();
      expect(screen.getByText('banking-api')).toBeInTheDocument();
      expect(screen.getByText('read write')).toBeInTheDocument();
    });

    it('displays claim descriptions for user token', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="user" onClose={() => {}} />
      );
      const description = screen.getByText(/RFC 7519 §4\.1\.2/);
      expect(description).toBeInTheDocument();
    });
  });

  describe('Agent Token Claims', () => {
    it('displays correct title for agent token type', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="agent" onClose={() => {}} />
      );
      expect(screen.getByText('Agent Token Claims')).toBeInTheDocument();
    });

    it('renders all agent token claims', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="agent" onClose={() => {}} />
      );
      expect(screen.getByText('sub')).toBeInTheDocument();
      expect(screen.getByText('iss')).toBeInTheDocument();
      expect(screen.getByText('aud')).toBeInTheDocument();
      expect(screen.getByText('exp')).toBeInTheDocument();
      expect(screen.getByText('iat')).toBeInTheDocument();
      expect(screen.getByText('act')).toBeInTheDocument();
      expect(screen.getByText('scope')).toBeInTheDocument();
      expect(screen.getByText('client_id')).toBeInTheDocument();
      expect(screen.getByText('cnf')).toBeInTheDocument();
    });

    it('displays agent-specific claim values', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="agent" onClose={() => {}} />
      );
      expect(screen.getByText('agent-client-id')).toBeInTheDocument();
      expect(screen.getByText('mcp-server')).toBeInTheDocument();
      expect(screen.getByText('mcp:read mcp:write')).toBeInTheDocument();
    });
  });

  describe('MCP Token Claims', () => {
    it('displays correct title for mcp token type', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="mcp" onClose={() => {}} />
      );
      expect(screen.getByText('MCP Token Claims')).toBeInTheDocument();
    });

    it('renders all mcp token claims', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="mcp" onClose={() => {}} />
      );
      expect(screen.getByText('sub')).toBeInTheDocument();
      expect(screen.getByText('iss')).toBeInTheDocument();
      expect(screen.getByText('aud')).toBeInTheDocument();
      expect(screen.getByText('exp')).toBeInTheDocument();
      expect(screen.getByText('iat')).toBeInTheDocument();
      expect(screen.getByText('act')).toBeInTheDocument();
      expect(screen.getByText('scope')).toBeInTheDocument();
      expect(screen.getByText('client_id')).toBeInTheDocument();
      expect(screen.getByText('authorization_details')).toBeInTheDocument();
      expect(screen.getByText('cnf')).toBeInTheDocument();
    });

    it('displays mcp-specific claim values', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="mcp" onClose={() => {}} />
      );
      expect(screen.getByText('mcp-client-id')).toBeInTheDocument();
      expect(screen.getByText('mcp-tool-client')).toBeInTheDocument();
    });
  });

  describe('Modal interactions', () => {
    it('closes when close button is clicked', async () => {
      const onClose = vi.fn();
      render(
        <ClaimDetailsModal isOpen={true} tokenType="user" onClose={onClose} />
      );
      const closeButton = screen.getByRole('button', { name: 'Close' });
      await userEvent.click(closeButton);
      expect(onClose).toHaveBeenCalled();
    });

    it('does not close when modal content is clicked', async () => {
      const onClose = vi.fn();
      render(
        <ClaimDetailsModal isOpen={true} tokenType="user" onClose={onClose} />
      );
      const modalContent = screen.getByText('User Token Claims');
      await userEvent.click(modalContent);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('passes correct props to DraggableModal', () => {
      const onClose = vi.fn();
      render(
        <ClaimDetailsModal isOpen={true} tokenType="agent" onClose={onClose} />
      );
      expect(screen.getByTestId('draggable-modal')).toBeInTheDocument();
      expect(screen.getByText('Agent Token Claims')).toBeInTheDocument();
    });
  });

  describe('Content rendering', () => {
    it('applies correct CSS classes to claim items', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="user" onClose={() => {}} />
      );
      const claimItems = document.querySelectorAll('.utfi-claim-item');
      expect(claimItems.length).toBeGreaterThan(0);

      claimItems.forEach((item) => {
        expect(item.querySelector('.utfi-claim-key')).toBeInTheDocument();
        expect(item.querySelector('.utfi-claim-value')).toBeInTheDocument();
        expect(item.querySelector('.utfi-claim-description')).toBeInTheDocument();
      });
    });
  });

  describe('Edge cases', () => {
    it('handles unknown token type gracefully', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="unknown" onClose={() => {}} />
      );
      expect(screen.getByText('Token Claims')).toBeInTheDocument();
      // Should render empty claims list
      const claimsList = document.querySelector('.utfi-claims-list');
      expect(claimsList?.children.length || 0).toBe(0);
    });

    it('handles undefined tokenType', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType={undefined} onClose={() => {}} />
      );
      expect(screen.getByText('Token Claims')).toBeInTheDocument();
    });
  });

  describe('Live claims', () => {
    it('shows this run\'s real values instead of the static examples', () => {
      render(
        <ClaimDetailsModal
          isOpen={true}
          tokenType="mcp"
          liveClaims={{ aud: 'https://mcp.example.com', scope: 'write:transfer' }}
          onClose={() => {}}
        />
      );
      expect(screen.getByText('https://mcp.example.com')).toBeInTheDocument();
      expect(screen.getByText('write:transfer')).toBeInTheDocument();
      // Static examples for this tokenType must not leak in alongside real data.
      expect(screen.queryByText('banking-api')).not.toBeInTheDocument();
      expect(screen.queryByText('read')).not.toBeInTheDocument();
      expect(screen.getByText('Live — this run')).toBeInTheDocument();
    });

    it('keeps the RFC description for a key that also has live data', () => {
      render(
        <ClaimDetailsModal
          isOpen={true}
          tokenType="mcp"
          liveClaims={{ aud: 'https://mcp.example.com' }}
          onClose={() => {}}
        />
      );
      expect(screen.getByText(/RFC 8707/)).toBeInTheDocument();
    });

    it('falls back to the static examples when liveClaims is empty', () => {
      render(
        <ClaimDetailsModal isOpen={true} tokenType="user" liveClaims={{}} onClose={() => {}} />
      );
      expect(screen.getByText('user-12345')).toBeInTheDocument();
      expect(screen.queryByText('Live — this run')).not.toBeInTheDocument();
    });
  });
});
