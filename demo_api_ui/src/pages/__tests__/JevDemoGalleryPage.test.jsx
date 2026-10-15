import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JevDemoGalleryPage from '../JevDemoGalleryPage';

// One mocked fetch that answers every /api/demo/jev/* call in simulated mode.
function mockFetchBody(url, body) {
  if (url === '/api/demo/jev/evaluate') {
    const choice = body.scenario === 'uiAction' || body.scenario === 'gameMove' || body.scenario === 'tradeSide'
      ? { type: 'choice', choice: 'jump', probabilities: { jump: 0.8 }, confidence: 0.8 }
      : body.scenario === 'paperTopic' || body.scenario === 'docType' || body.scenario === 'uiAction'
        ? { type: 'choice', choice: 'agents', probabilities: { agents: 0.9 }, confidence: 0.9 }
        : null;
    return {
      scenario: body.scenario,
      jev: { mode: 'simulated', model: 'keyword-heuristic', latencyMs: 1, answer: choice || { type: 'noul', probability: 0.9 } },
      heuristic: { latencyMs: 0, answer: choice ? { ...choice, confidence: 1 } : { type: 'noul', probability: 0 } },
    };
  }
  // batch
  return {
    scenario: body.scenario,
    totalLatencyMs: 2,
    jev: body.states.map(() => ({ mode: 'simulated', model: 'keyword-heuristic', latencyMs: 1, answer: { type: 'noul', probability: 0.9 } })),
    heuristic: { latencyMs: 0, answers: body.states.map(() => ({ type: 'noul', probability: 0 })) },
  };
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jev-demos/:demoId" element={<JevDemoGalleryPage user={null} logout={() => {}} />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  global.fetch = vi.fn(async (url, opts) => ({
    ok: true,
    status: 200,
    json: async () => mockFetchBody(url, JSON.parse(opts.body)),
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('JevDemoGalleryPage', () => {
  it('renders each demo by id with its title and reported figures', () => {
    for (const id of ['pr-review', 'computer-use', 'internal-links', 'doc-sort', 'game-agent', 'compaction', 'trading', 'papers']) {
      const { unmount } = renderAt(`/jev-demos/${id}`);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('eight things');
      expect(screen.getAllByRole('button', { name: /Run|Decide|Classify|Score|Review/i }).length).toBeGreaterThan(0);
      expect(document.body.textContent).toMatch(/Reported by the demo’s creator/);
      unmount();
    }
  });

  it('PR review: runs the batch and shows the escalation band', async () => {
    const user = userEvent.setup();
    renderAt('/jev-demos/pr-review');
    await user.click(screen.getByRole('button', { name: /Run 6 checks/i }));
    await waitFor(() => expect(screen.getAllByText(/block \/ security review|safe to merge|escalate to a person/i).length).toBeGreaterThan(0));
    // Mock answers 0.9 for every check → all six land above the band: 6 block.
    expect(screen.getByText((_, el) => el?.className === 'jev-big' && /6 block · 0 escalate · 0 pass/.test(el.textContent || ''))).toBeTruthy();
  });

  it('computer use: decides for the active screen', async () => {
    const user = userEvent.setup();
    renderAt('/jev-demos/computer-use');
    await user.click(screen.getByRole('button', { name: /Decide next action/i }));
    await waitFor(() => expect(screen.getAllByText(/80% confident/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Expected:/)).toBeTruthy();
  });

  it('renders the nav links for all eight demos', () => {
    renderAt('/jev-demos/pr-review');
    for (const label of ['PR Review', 'Computer Use', 'Internal Links', 'Doc Sorting', 'Game Agent', 'Context Compaction', 'Trading Bot', 'Paper Organizer']) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', expect.stringContaining('/jev-demos/'));
    }
  });

  // Regression: internal-links' baselineCell used to read r.text, a field the
  // batch rows never carry — it crashed only when RUN, not on render, so the
  // render-everything test above stayed green. Run every batch demo.
  it.each([
    ['internal-links', /Score 4 page pairs/i],
    ['doc-sort', /Classify 5 pages/i],
    ['compaction', /Score the transcript/i],
    ['papers', /Classify 5 papers/i],
  ])('%s: runs to completion without crashing', async (id, buttonName) => {
    const user = userEvent.setup();
    renderAt(`/jev-demos/${id}`);
    await user.click(screen.getByRole('button', { name: buttonName }));
    await waitFor(() => expect(document.querySelector('.jev-table tbody tr')).toBeTruthy());
    expect(document.querySelectorAll('.jev-error').length).toBe(0);
  });

  // The two frame-loop demos (one evaluate per frame) had no run test.
  it.each(['game-agent', 'trading'])('%s: runs the decision loop to completion', async (id) => {
    const user = userEvent.setup();
    renderAt(`/jev-demos/${id}`);
    const run = document.querySelector('button.btn-primary');
    await user.click(run);
    await waitFor(() => expect(run.disabled).toBe(false));
    expect(document.querySelectorAll('.jev-error').length).toBe(0);
    expect(run.textContent).not.toMatch(/Running/);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('falls back to PR review for an unknown demo id', () => {
    renderAt('/jev-demos/whatever');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('pull requests');
  });

  it('shows an inline error when the backend fails', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ message: 'Jev did not answer; try again.' }) }));
    const user = userEvent.setup();
    renderAt('/jev-demos/pr-review');
    await user.click(screen.getByRole('button', { name: /Run 6 checks/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Jev did not answer/));
  });

  // Regression: the batch endpoint returns error rows as {mode:'error'} with
  // NO answer (one failed state must not fail the batch), but the UI read
  // answer.probability on every row — a partial failure crashed the page in
  // useMemo instead of showing the failed row.
  it('pr-review: renders error rows ungraded instead of crashing', async () => {
    global.fetch = vi.fn(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      const jev = body.states.map((_, i) => (i === 2
        ? { mode: 'error', error: 'von-jev timed out' }
        : { mode: 'live', model: 'von-1.3.0', latencyMs: 5, answer: { type: 'noul', probability: 0.9 } }));
      return { ok: true, status: 200, json: async () => ({ scenario: body.scenario, jev, heuristic: { latencyMs: 0, answers: body.states.map(() => ({ type: 'noul', probability: 0 })) } }) };
    });
    const user = userEvent.setup();
    renderAt('/jev-demos/pr-review');
    await user.click(screen.getByRole('button', { name: /Run 6 checks/i }));
    await waitFor(() => expect(screen.getByText((_, el) => el?.className === 'jev-big' && /5 block · 0 escalate · 0 pass · 1 failed/.test(el.textContent || ''))).toBeTruthy());
    expect(screen.getByText('score failed')).toBeTruthy();
    expect(screen.getByText('von-jev timed out')).toBeTruthy();
  });

  it('batch demo: renders an error row as unscored instead of crashing', async () => {
    global.fetch = vi.fn(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      const jev = body.states.map((_, i) => (i === 0
        ? { mode: 'error', error: 'rate limited' }
        : { mode: 'live', model: 'von-1.3.0', latencyMs: 5, answer: { type: 'noul', probability: 0.2 } }));
      return { ok: true, status: 200, json: async () => ({ scenario: body.scenario, jev, heuristic: { latencyMs: 0, answers: body.states.map(() => ({ type: 'noul', probability: 0 })) } }) };
    });
    const user = userEvent.setup();
    renderAt('/jev-demos/compaction');
    await user.click(screen.getByRole('button', { name: /Score the transcript/i }));
    await waitFor(() => expect(document.querySelector('.jev-table tbody tr')).toBeTruthy());
    expect(screen.getAllByText(/rate limited/).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.jev-table tbody tr').length).toBe(8);
  });

  it('the page toggle sends mode heuristics on a run and is remembered', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    renderAt('/jev-demos/game-agent');
    await user.click(screen.getByRole('radio', { name: 'Heuristics' }));
    expect(localStorage.getItem('agentMode:jev-gallery')).toBe('heuristics');
    const run = document.querySelector('button.btn-primary');
    await user.click(run);
    await waitFor(() => expect(run.disabled).toBe(false));
    const bodies = global.fetch.mock.calls.filter(([u]) => String(u).includes('/api/demo/jev/')).map(([, o]) => JSON.parse(o.body));
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every((b) => b.mode === 'heuristics')).toBe(true);
    localStorage.clear();
  });
});
