// demo_api_ui/src/pages/check/__tests__/views.test.jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CardsView from '../CardsView';
import StepperView from '../StepperView';
import ChecklistView from '../ChecklistView';
import RailDetailView from '../RailDetailView';

const catalog = { flags: {}, checks: [
  { id: 'servers.all_up', name: 'All servers running', category: 'Servers' },
  { id: 'llm.status', name: 'LLM models', category: 'LLM' },
] };

test('CardsView shows a card per category with worst-status class', () => {
  const results = { 'servers.all_up': { id: 'servers.all_up', category: 'Servers', status: 'pass', detail: '12/12 up' } };
  render(<CardsView catalog={catalog} results={results} verdict="ready" />);
  expect(screen.getByText('Servers')).toBeInTheDocument();
  expect(screen.getByText('LLM')).toBeInTheDocument();
  expect(screen.getByText(/12\/12 up/)).toBeInTheDocument();
});

test('CardsView: clicking a card expands its individual checks below the grid', async () => {
  const user = userEvent.setup();
  const results = { 'servers.all_up': { id: 'servers.all_up', category: 'Servers', status: 'pass', detail: '12/12 up' } };
  render(<CardsView catalog={catalog} results={results} verdict="ready" />);

  expect(screen.queryByText('All servers running')).not.toBeInTheDocument();

  await user.click(screen.getByText('Servers'));
  expect(screen.getByText('All servers running')).toBeInTheDocument();
  expect(screen.getAllByText(/12\/12 up/).length).toBeGreaterThan(0);

  await user.click(screen.getByText('Servers'));
  expect(screen.queryByText('All servers running')).not.toBeInTheDocument();
});

test('StepperView renders category labels without crashing', () => {
  const results = { 'servers.all_up': { id: 'servers.all_up', category: 'Servers', status: 'pass', detail: '12/12 up' } };
  render(<StepperView catalog={catalog} results={results} verdict="ready" />);
  expect(screen.getAllByText('Servers').length).toBeGreaterThan(0);
  expect(screen.getAllByText('LLM').length).toBeGreaterThan(0);
});

test('ChecklistView renders category labels without crashing', () => {
  const results = { 'servers.all_up': { id: 'servers.all_up', category: 'Servers', status: 'pass', detail: '12/12 up' } };
  render(<ChecklistView catalog={catalog} results={results} verdict="ready" />);
  expect(screen.getByText('Servers')).toBeInTheDocument();
  expect(screen.getByText('LLM')).toBeInTheDocument();
});

test('RailDetailView renders category labels without crashing', () => {
  const results = { 'servers.all_up': { id: 'servers.all_up', category: 'Servers', status: 'pass', detail: '12/12 up' } };
  render(<RailDetailView catalog={catalog} results={results} verdict="ready" />);
  expect(screen.getAllByText('Servers').length).toBeGreaterThan(0);
  expect(screen.getByText('LLM')).toBeInTheDocument();
});

test('ChecklistView renders an out-of-catalog result (e.g. chip test) under its own category', () => {
  const results = {
    'servers.all_up': { id: 'servers.all_up', category: 'Servers', status: 'pass', detail: '12/12 up' },
    'chip.e2e': { id: 'chip.e2e', name: 'Chip end-to-end', category: 'End-to-End Chip', status: 'pass', detail: 'Agent called a tool' },
  };
  render(<ChecklistView catalog={catalog} results={results} verdict="ready" />);
  expect(screen.getByText('End-to-End Chip')).toBeInTheDocument();
  expect(screen.getByText('Chip end-to-end')).toBeInTheDocument();
  expect(screen.getByText(/Agent called a tool/)).toBeInTheDocument();
});
