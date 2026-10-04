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

  it('bake-off shows Jev as a block/allow verdict at 0.50, and says so when no score lands in the middle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.9)));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run bake-off' }));
    await waitFor(() => expect(screen.getAllByText('block (0.90)')).toHaveLength(8));
    expect(screen.getByText(/No message scored between 0.35 and 0.65/)).toBeTruthy();
  });

  it('intent bake-off scores pick vs truth and names the most confident miss', async () => {
    const choice = (pick, confidence) => ({
      ok: true,
      json: async () => ({
        jev: { mode: 'live', model: 'm', latencyMs: 5, answer: { type: 'choice', choice: pick, confidence } },
        heuristic: { latencyMs: 0, answer: { type: 'choice', choice: 'other', confidence: 1 } },
      }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(choice('transfer_money', 0.9)));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run intent bake-off' }));
    // Jev always says transfer_money: right on the 3 transfers; Rules always says other: right on the 2 others.
    await waitFor(() => expect(screen.getByText(/Rules 2\/8 - Jev 3\/8/)).toBeTruthy());
    expect(screen.getAllByText('transfer_money (90%)')).toHaveLength(8);
    expect(screen.getByText(/ranged from 90% to 90%/)).toBeTruthy();
    expect(screen.getByText(/Confidence is not correctness/)).toBeTruthy();
  });

  it('bake-off omits the "no middle" note when a score lands between 0.35 and 0.65', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.5)));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run bake-off' }));
    await waitFor(() => expect(screen.getAllByText('block (0.50)')).toHaveLength(8));
    expect(screen.queryByText(/No message scored between/)).toBeNull();
  });
});
