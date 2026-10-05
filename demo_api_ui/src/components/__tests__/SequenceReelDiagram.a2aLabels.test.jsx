import { render, screen, act } from '@testing-library/react';
import SequenceReelDiagram from '../SequenceReelDiagram';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

beforeEach(() => {
  tokenChainTraceStore.reset();
  localStorage.clear();
});

const hops = (labelled) => [
  { id: 'pa2a-0', kind: 'delegate', from: 'main', to: 'analyst', status: 'ok', ...(labelled ? { fromLabel: 'CareConnect agent', toLabel: 'Records Specialist' } : {}) },
  { id: 'pa2a-1', kind: 'result', from: 'analyst', to: 'main', status: 'ok', ...(labelled ? { fromLabel: 'Records Specialist', toLabel: 'CareConnect agent' } : {}) },
];

test('column headers use the vertical names while lane keys stay put', () => {
  render(<SequenceReelDiagram slowMode={false} />);
  act(() => {
    tokenChainTraceStore.beginTrace({ prompt: 'review' });
    tokenChainTraceStore.ingestTokenEvents(hops(true));
  });
  expect(screen.getAllByText(/CareConnect agent/i, { selector: '.srd-actor-label' }).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Records Specialist/i, { selector: '.srd-actor-label' }).length).toBeGreaterThan(0);
  expect(document.querySelector('.srd-lane-main-agent')).not.toBeNull();
  expect(document.querySelector('.srd-lane-analyst-agent')).not.toBeNull();
});

test('without labels the headers are today lane names', () => {
  render(<SequenceReelDiagram slowMode={false} />);
  act(() => {
    tokenChainTraceStore.beginTrace({ prompt: 'review' });
    tokenChainTraceStore.ingestTokenEvents(hops(false));
  });
  expect(screen.getAllByText(/ANALYST AGENT/i, { selector: '.srd-actor-label' }).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Records Specialist/i, { selector: '.srd-actor-label' })).toBeNull();
});
