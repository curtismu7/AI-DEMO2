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

  it('labels developer tools as the developer path and shows no presenter note', () => {
    for (const a of EXTERNAL_AGENTS.filter((x) => x.path === 'developer')) {
      const { unmount } = renderAt(`/external-agents/${a.id}`);
      expect(screen.getByTestId('agent-path')).toHaveTextContent(/Developer path/);
      expect(screen.queryByTestId('presenter-rehearsal')).toBeNull();
      unmount();
    }
  });

  it('consumer assistants show directory-only customer steps; the URL sits only in the presenter-only note', () => {
    for (const a of EXTERNAL_AGENTS.filter((x) => x.path === 'directory')) {
      const { unmount, container } = renderAt(`/external-agents/${a.id}`);
      expect(screen.getByTestId('agent-path')).toHaveTextContent(/Customer path/);
      const steps = container.querySelector('ol.lesson-steps');
      expect(steps.textContent, a.id).not.toMatch(/https?:\/\/|paste/i);
      expect(steps.textContent, a.id).toMatch(/directory/i);
      const note = screen.getByRole('complementary', { name: 'Presenter only' });
      expect(note).toHaveTextContent(/Never shown to customers/);
      expect(note).toHaveTextContent('https://cmuir-mcp.ping-devops.com/mcp');
      // Outside the presenter note, the page shows no MCP URL at all.
      const outside = container.cloneNode(true);
      outside.querySelector('[data-testid="presenter-rehearsal"]').remove();
      expect(outside.textContent, a.id).not.toContain('cmuir-mcp.ping-devops.com');
      unmount();
    }
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
