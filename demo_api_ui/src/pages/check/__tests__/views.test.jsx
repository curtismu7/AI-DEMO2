// demo_api_ui/src/pages/check/__tests__/views.test.jsx
import { render, screen } from '@testing-library/react';
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
