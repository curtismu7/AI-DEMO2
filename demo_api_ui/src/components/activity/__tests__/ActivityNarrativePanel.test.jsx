import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityNarrativeProvider, useActivityNarrative } from '../../../context/ActivityNarrativeContext';
import ActivityNarrativePanel from '../ActivityNarrativePanel';
import { act } from '@testing-library/react';

function Harness() {
  const ctx = useActivityNarrative();
  // expose for the test via window
  window.__act = ctx;
  return <ActivityNarrativePanel isOpen onClose={() => {}} />;
}

describe('ActivityNarrativePanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ActivityNarrativeProvider>
        <ActivityNarrativePanel isOpen={false} onClose={() => {}} />
      </ActivityNarrativeProvider>,
    );
    expect(container.querySelector('.anp-card')).toBeNull();
  });

  it('renders the current request expanded with its steps', () => {
    render(
      <ActivityNarrativeProvider>
        <Harness />
      </ActivityNarrativeProvider>,
    );
    act(() => {
      window.__act.startRequest('check balance');
      window.__act.upsertStep({ key: 'tool:t1', text: 'Reading your balance…', status: 'running', tone: 'neutral' });
    });
    expect(screen.getByText('You asked: check balance')).toBeInTheDocument();
    expect(screen.getByText('Reading your balance…')).toBeInTheDocument();
  });
});
