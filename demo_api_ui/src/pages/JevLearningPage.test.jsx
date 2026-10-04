import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import JevLearningPage from './JevLearningPage';
import { decide, BAKEOFF, INTENT_BAKEOFF, RECORDED_RUN, guardrailReadout, intentReadout } from './jevLessons';

// Both bake-offs now show a recorded example before a live run, so scope queries to one section.
const guardrail = () => within(screen.getByRole('region', { name: 'Guardrail bake-off' }));
const intent = () => within(screen.getByRole('region', { name: 'Intent-routing bake-off' }));

afterEach(() => vi.restoreAllMocks());

const reply = (probability, mode = 'live') => ({
  ok: true,
  json: async () => ({
    jev: { mode, model: 'm', latencyMs: 5, answer: { type: 'noul', probability } },
    heuristic: { latencyMs: 0, answer: { type: 'noul', probability: 0 } },
  }),
});

describe('bake-off readouts', () => {
  it('guardrailReadout separates missed attacks from false alarms for each decider', () => {
    const rows = [
      { text: 'a', bad: true, rules: true, jev: 0.9 },   // both block: fine
      { text: 'b', bad: true, rules: false, jev: 0.1 },  // both miss
      { text: 'c', bad: false, rules: true, jev: 0.1 },  // rules false alarm
      { text: 'd', bad: false, rules: false, jev: 0.7 }, // jev false alarm
    ];
    expect(guardrailReadout(rows)).toEqual({
      rules: { missed: ['b'], falseAlarms: ['c'] },
      jev: { missed: ['b'], falseAlarms: ['d'] },
    });
  });

  it('intentReadout lists each decider\'s wrong picks, with Jev\'s confidence', () => {
    const rows = [
      { text: 'a', truth: 'other', rules: 'other', jev: 'other', conf: 0.9 },
      { text: 'b', truth: 'other', rules: 'other', jev: 'transfer_money', conf: 0.99 },
      { text: 'c', truth: 'check_balance', rules: 'other', jev: 'check_balance', conf: 0.8 },
    ];
    expect(intentReadout(rows)).toEqual({
      rules: [{ text: 'c', got: 'other' }],
      jev: [{ text: 'b', got: 'transfer_money', conf: 0.99 }],
    });
  });
});

describe('recorded example', () => {
  it('is measured data for exactly the corpus on screen', () => {
    expect(RECORDED_RUN.guardrail.map((r) => [r.text, r.bad])).toEqual(BAKEOFF.map((r) => [r.text, r.bad]));
    expect(RECORDED_RUN.intent.map((r) => [r.text, r.truth])).toEqual(INTENT_BAKEOFF.map((r) => [r.text, r.truth]));
  });

  it('both bake-offs explain themselves before anything is run, labelled as recorded', () => {
    render(<JevLearningPage />);
    expect(guardrail().getByText(/Rules 5\/8 - Jev 6\/8/)).toBeTruthy();
    expect(intent().getByText(/Rules 7\/8 - Jev 5\/8/)).toBeTruthy();
    for (const section of [guardrail(), intent()]) {
      expect(section.getByText('Recorded: von-1.3.0, 4 Oct 2026')).toBeTruthy();
      expect(section.getByText(/example run recorded from von-1\.3\.0/)).toBeTruthy();
      expect(section.getByText('What this shows')).toBeTruthy();
    }
    expect(screen.queryByText(/Live: /)).toBeNull(); // a recording is never badged as live
  });

  it('stays on screen under the error when a live run fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ message: 'Jev did not answer; try again.' }) }));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run bake-off' }));
    await waitFor(() => expect(guardrail().getByRole('alert').textContent).toMatch(/Jev did not answer/));
    expect(guardrail().getByText(/Rules 5\/8 - Jev 6\/8/)).toBeTruthy();
    expect(guardrail().getByText(/Recorded: /)).toBeTruthy();
  });
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
    await waitFor(() => expect(guardrail().queryByText(/Recorded:/)).toBeNull());
    // mock: rules allow everything (right on the 4 harmless), Jev blocks everything (right on the 4 hostile)
    expect(guardrail().getByText(/Rules 4\/8 - Jev 4\/8/)).toBeTruthy();
    expect(BAKEOFF).toHaveLength(8);
  });

  it('bake-off shows Jev as a block/allow verdict at 0.50, and says so when no score lands in the middle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.9)));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run bake-off' }));
    await waitFor(() => expect(screen.getAllByText('block (0.90)')).toHaveLength(8));
    expect(screen.getByText(/No message scored between 0.35 and 0.65/)).toBeTruthy();
    // The mock's rules never block (4 missed attacks); Jev blocks everything (4 false alarms).
    expect(screen.getByText(/Missed attacks: 4 /)).toBeTruthy();
    expect(screen.getByText(/False alarms: 4 /)).toBeTruthy();
    expect(guardrail().getByText(/How to read it: /)).toBeTruthy();
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
    expect(screen.getByText(/Wrong picks: "What is my checking balance\?" as other/)).toBeTruthy();
    expect(screen.getByText(/a 99% answer can still be wrong/)).toBeTruthy();
  });

  it('bake-off omits the "no middle" note when a score lands between 0.35 and 0.65', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.5)));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run bake-off' }));
    await waitFor(() => expect(screen.getAllByText('block (0.50)')).toHaveLength(8));
    expect(screen.queryByText(/No message scored between/)).toBeNull();
  });
});
