import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ExternalAgentLessonPage from '../ExternalAgentLessonPage';
import { EXTERNAL_AGENTS } from '../../config/externalAgents';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/external-agents/:agentId" element={<ExternalAgentLessonPage />} />
        <Route path="*" element={<ExternalAgentLessonPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ExternalAgentLessonPage', () => {
  it('renders per-agent content from the route param', () => {
    renderAt('/external-agents/muse-code');
    expect(screen.getByRole('heading', { name: /Muse Code/i })).toBeInTheDocument();
    expect(screen.getByText(/streamable_http/i)).toBeInTheDocument();
    expect(screen.getByText(/transfer/i)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/expected flow, not yet app-verified/i);
  });

  it('renders the coverage list and diagram links for every agent', () => {
    for (const a of EXTERNAL_AGENTS) {
      const { unmount } = renderAt(`/external-agents/${a.id}`);
      expect(screen.getByRole('link', { name: /standard lane \(UC-MUSE1\)/i })).toHaveAttribute('href', '/use-case-diagrams/UC-MUSE1');
      unmount();
    }
  });

  it('unknown agent renders a not-found state', () => {
    renderAt('/external-agents/nope');
    expect(screen.getByText(/unknown agent/i)).toBeInTheDocument();
  });
});
