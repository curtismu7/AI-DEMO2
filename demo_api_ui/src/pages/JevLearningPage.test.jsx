import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import JevLearningPage from './JevLearningPage';
import { decide, BAKEOFF } from './jevLessons';

afterEach(() => vi.restoreAllMocks());

const reply = (probability, mode = 'live') => ({
  ok: true,
  json: async () => ({
    jev: { mode, model: 'm', latencyMs: 5, answer: { type: 'noul', probability } },
    heuristic: { latencyMs: 0, answer: { type: 'noul', probability: 0 } },
  }),
});

describe('decide', () => {
  it('maps a score to allow / stepup / deny by the policy lines, not the model', () => {
    expect(decide(0.1, 0.4, 0.9)).toBe('allow');
    expect(decide(0.4, 0.4, 0.9)).toBe('stepup');
    expect(decide(0.95, 0.4, 0.9)).toBe('deny');
    expect(decide(0.95, 0.4, 0.99)).toBe('stepup');
  });
});

describe('JevLearningPage', () => {
  it('renders signed out and labels simulated mode as not evidence about Jev', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(1, 'simulated')));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getByText(/Simulated - not configured/)).toBeTruthy());
    expect(screen.getByText(/says nothing about Jev/)).toBeTruthy();
  });

  it('a risk run loads its score into the threshold lesson', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.97)));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Step-up risk' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getByText('0.97')).toBeTruthy());
  });

  it('each result box explains itself, and the Jev box quotes its score in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.84)));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getByText(/fixed list of trigger words/)).toBeTruthy());
    expect(screen.getByText(/about 84%/)).toBeTruthy();
  });

  it('bake-off posts every corpus message and shows an inline error on failure', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ message: 'Too many Jev requests.' }) });
    vi.stubGlobal('fetch', f);
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run bake-off' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Too many Jev requests/));

    f.mockResolvedValue(reply(0.9));
    fireEvent.click(screen.getByRole('button', { name: 'Run bake-off' }));
    await waitFor(() => expect(screen.getByText(/Rules \d+\/8/)).toBeTruthy());
    expect(BAKEOFF).toHaveLength(8);
  });
});
