import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import JevLearningPage from './JevLearningPage';
import { decide, BAKEOFF, INTENT_BAKEOFF, RECORDED_RUN, guardrailReadout, intentReadout } from './jevLessons';

// Both bake-offs now show a recorded example before a live run, so scope queries to one section.
const guardrail = () => within(screen.getByRole('region', { name: 'Guardrail bake-off' }));
const intent = () => within(screen.getByRole('region', { name: 'Intent-routing bake-off' }));
// The page has two Decide buttons since the LangChain panel; the live panel is the first.
const livePanel = () => within(screen.getByRole('region', { name: 'Same input, two deciders' }));

afterEach(() => vi.restoreAllMocks());
const SCENARIO_FIRST_EXAMPLE_INTENT = 'Pay Sam twenty bucks for lunch';

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
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getByText(/Simulated - not configured/)).toBeTruthy());
    expect(screen.getByText(/says nothing about Jev/)).toBeTruthy();
  });

  it('a risk run loads its score into the threshold lesson', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.97)));
    render(<JevLearningPage />);
    fireEvent.click(livePanel().getByRole('tab', { name: 'Step-up risk' }));
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getByText('0.97')).toBeTruthy());
  });

  it('shows the Ping spinner while the model call is in flight', async () => {
    // Von's first call after a cold start takes up to ~23s; with no in-flight
    // indicator the panel reads as frozen. The spinner must be present while
    // busy and gone once the result lands.
    let resolveReply;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((resolve) => { resolveReply = resolve; })));
    render(<JevLearningPage />);
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    // The progress region is mounted before the run (see the Ping UI conversion block below); it carries the words.
    expect(await screen.findByText(/Jev is reading the text/i)).toBeTruthy();
    expect(screen.getByTestId('jevl-live-status').textContent).toMatch(/Running/);
    resolveReply(reply(0.82));
    await waitFor(() => expect(screen.queryByText(/Jev is reading the text/i)).toBeNull());
    expect(livePanel().getByText('P(yes) = 0.82')).toBeTruthy();
  });

  it('each result box explains itself, and the Jev box quotes its score in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.84)));
    render(<JevLearningPage />);
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getByText(/matched nothing on its trigger-word list/i)).toBeTruthy());
    expect(screen.getByText(/about 84%/)).toBeTruthy();
  });

  it('says how a service uses the score: policy thresholds, with the slider as the worked example', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.84)));
    render(<JevLearningPage />);
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getAllByText(/allow below 0\.4/i).length).toBeGreaterThan(0));
  });

  it('the rules verdict flips its explanation when a trigger phrase matches', async () => {
    const hit = { ok: true, json: async () => ({
      jev: { mode: 'live', model: 'm', latencyMs: 5, answer: { type: 'noul', probability: 0.9 } },
      heuristic: { latencyMs: 0, answer: { type: 'noul', probability: 1 } },
    }) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hit));
    render(<JevLearningPage />);
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getAllByText(/matched a trigger phrase/i).length).toBeGreaterThan(0));
  });

  it('explains the scenario itself - what a prompt injection is and why these examples', () => {
    render(<JevLearningPage />);
    expect(screen.getAllByText(/A prompt injection is text that tries to take over the assistant/).length).toBe(2);
    fireEvent.click(livePanel().getByRole('tab', { name: 'Step-up risk' }));
    expect(screen.getByText(/Fraudulent transfers are urgent, oversized, or go to new payees/)).toBeTruthy();
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

  it('the intent how-to-read note names the Hi-there confident miss and ties it to the failure-mode table', () => {
    render(<JevLearningPage />);
    expect(screen.getAllByText(/Watch "Hi there": Jev calls it transfer_money with 99% confidence/).length).toBe(1);
    expect(screen.getAllByText(/a confident wrong label\. A real router treats a pick like this as one candidate/).length).toBe(1);
  });

  it('bake-off omits the "no middle" note when a score lands between 0.35 and 0.65', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.5)));
    render(<JevLearningPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Run bake-off' }));
    await waitFor(() => expect(screen.getAllByText('block (0.50)')).toHaveLength(8));
    expect(screen.queryByText(/No message scored between/)).toBeNull();
  });
});

describe('LangChain integration panel', () => {
  const lc = () => within(screen.getByRole('region', { name: 'The same lesson through LangChain' }));
  const lcReply = (body) => ({
    ok: true,
    json: async () => body,
  });
  const agentLive = {
    proxied: true,
    langchain: {
      mode: 'live',
      model: 'von-1.3.0',
      latency_ms: 443,
      answer: { type: 'noul', probability: 0.8291 },
      usage: { input_tokens: 94, output_tokens: 1 },
    },
    heuristic: { latencyMs: 0, answer: { type: 'noul', probability: 1 } },
  };

  it('runs the scenario through the BFF and shows the typed answer with token usage', async () => {
    const f = vi.fn().mockResolvedValue(lcReply(agentLive));
    vi.stubGlobal('fetch', f);
    render(<JevLearningPage />);
    fireEvent.click(lc().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(lc().getByText('P(yes) = 0.83')).toBeTruthy());
    expect(f.mock.calls[0][0]).toBe('/api/demo/jev/langchain');
    expect(lc().getByText(/94 prompt · 1 completion/)).toBeTruthy();
    expect(lc().getByText('Live: von-1.3.0')).toBeTruthy();
    expect(lc().getByText('443 ms')).toBeTruthy();
    expect(lc().getByText('LangChain OpenAIDecisions')).toBeTruthy();
    // the keyword baseline runs here too, in the same panel
    expect(lc().getByText('P(yes) = 1.00')).toBeTruthy();
  });

  it('shows an inline error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ message: 'LangChain Jev did not answer; try again.' }) }));
    render(<JevLearningPage />);
    fireEvent.click(lc().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(lc().getByRole('alert').textContent).toMatch(/LangChain Jev did not answer/));
  });
});

describe('Ping UI Standard conversion', () => {
  const primaries = (root = document) => [...root.querySelectorAll('button.pu-btn--primary')];

  it('puts the honest banner first, then the title band, and says what is live, simulated and recorded', () => {
    const { container } = render(<JevLearningPage />);
    const page = container.firstElementChild;
    expect(page.classList.contains('pu-page')).toBe(true);
    const banner = screen.getByTestId('jevl-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(page.firstElementChild.contains(banner)).toBe(true); // first child of the page
    expect(banner.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.textContent).toMatch(/Live/);
    expect(banner.textContent).toMatch(/Simulated/);
    expect(banner.textContent).toMatch(new RegExp(`Recorded.*${RECORDED_RUN.model}`));
  });

  it('has exactly one primary button: Decide on the first live panel', () => {
    render(<JevLearningPage />);
    const found = primaries();
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(livePanel().getByRole('button', { name: 'Decide' }));
    for (const name of ['Run bake-off', 'Run intent bake-off']) {
      expect(screen.getByRole('button', { name }).classList.contains('pu-btn--primary')).toBe(false);
    }
  });

  it('Decide keeps focus while a run is in flight, ignores a second click, and keeps its name', async () => {
    let resolveReply;
    const f = vi.fn().mockReturnValue(new Promise((resolve) => { resolveReply = resolve; }));
    vi.stubGlobal('fetch', f);
    render(<JevLearningPage />);
    const decide = livePanel().getByRole('button', { name: 'Decide' });
    decide.focus();
    fireEvent.click(decide);
    await waitFor(() => expect(decide.getAttribute('aria-disabled')).toBe('true'));
    expect(decide.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(decide);
    expect(decide.textContent).toBe('Decide'); // the name does not change while the status region announces
    fireEvent.click(decide);
    expect(f).toHaveBeenCalledTimes(1);
    resolveReply(reply(0.3));
    await waitFor(() => expect(decide.getAttribute('aria-disabled')).toBeNull());
    expect(document.activeElement).toBe(decide);
  });

  it('empty text: Decide is aria-disabled with a visible reason and does not call the API', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<JevLearningPage />);
    fireEvent.change(livePanel().getByLabelText('Text to judge'), { target: { value: '   ' } });
    const decide = livePanel().getByRole('button', { name: 'Decide' });
    expect(decide.getAttribute('aria-disabled')).toBe('true');
    expect(livePanel().getByText(/Type or pick some text first/)).toBeTruthy();
    expect(livePanel().getByLabelText('Text to judge').getAttribute('aria-describedby')).toBe('jevl-live-reason');
    fireEvent.click(decide);
    expect(f).not.toHaveBeenCalled();
  });

  it('the progress region is mounted and empty before a run, says Running, then Finished or Failed', async () => {
    render(<JevLearningPage />);
    const region = screen.getByTestId('jevl-live-status');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent).toBe('');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.9)));
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getByTestId('jevl-live-status').textContent).toMatch(/Finished/));
    expect(screen.getByTestId('jevl-live-status')).toBe(region); // same node: it was never remounted

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ message: 'nope' }) }));
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(region.textContent).toMatch(/Failed/));
    expect(region.textContent).not.toMatch(/Finished/);
  });

  it('the Jev card chip and tone come from the mode the server reported', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(1, 'simulated')));
    render(<JevLearningPage />);
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    const card = await screen.findByTestId('jevl-live-jev');
    expect(card.classList.contains('pu-card--warn')).toBe(true);
    expect(within(card).getByText('Simulated - not configured').closest('.pu-chip').classList.contains('pu-chip--warn')).toBe(true);
    expect(screen.getByTestId('jevl-live-status').textContent).not.toMatch(/Jev is reading/);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(0.4, 'live')));
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(screen.getByTestId('jevl-live-jev').classList.contains('pu-card--live')).toBe(true));
    expect(within(screen.getByTestId('jevl-live-jev')).getByText('Live: m').closest('.pu-chip').classList.contains('pu-chip--info')).toBe(true);
  });

  it('recorded rows are a neutral chip, never green or blue', () => {
    render(<JevLearningPage />);
    const chip = guardrail().getByText('Recorded: von-1.3.0, 4 Oct 2026').closest('.pu-chip');
    expect(chip.classList.contains('pu-chip--neutral')).toBe(true);
  });

  it('a right or wrong verdict carries a word as well as colour', () => {
    render(<JevLearningPage />);
    const cells = [...screen.getByRole('region', { name: 'Guardrail bake-off' }).querySelectorAll('td.jevl-right, td.jevl-wrong')];
    expect(cells.length).toBeGreaterThan(0);
    for (const td of cells) {
      expect(td.textContent).toMatch(/^(?:\u2713|\u2715)(Right|Wrong): /);
    }
  });

  it('names the current policy outcome with a chip, on exactly one row', () => {
    render(<JevLearningPage />);
    expect(screen.getAllByText('Current outcome')).toHaveLength(1);
    const row = screen.getByText('Current outcome').closest('li');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.textContent).toMatch(/Step-up/); // the default score 0.62 sits between 0.4 and 0.9
  });

  it('scenario tabs and example buttons are secondaries that show the chosen one', () => {
    render(<JevLearningPage />);
    const tab = livePanel().getByRole('tab', { name: 'Intent routing' });
    fireEvent.click(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.className).toBe('pu-btn');
    const first = SCENARIO_FIRST_EXAMPLE_INTENT;
    expect(livePanel().getByRole('button', { name: first }).getAttribute('aria-pressed')).toBe('true');
    const second = livePanel().getByRole('button', { name: 'How much do I have left in savings?' });
    expect(second.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(second);
    expect(second.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a 100-character unbroken error inside its card (wrapping is page CSS; the text is in the alert)', async () => {
    const long = 'x'.repeat(100);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: long }) }));
    render(<JevLearningPage />);
    fireEvent.click(livePanel().getByRole('button', { name: 'Decide' }));
    await waitFor(() => expect(livePanel().getByRole('alert').textContent).toBe(long));
  });
});
