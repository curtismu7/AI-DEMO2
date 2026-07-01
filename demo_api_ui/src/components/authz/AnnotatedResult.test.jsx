import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import AnnotatedResult from './AnnotatedResult';

describe('AnnotatedResult', () => {
  test('renders nothing when result is null', () => {
    const { container } = render(<AnnotatedResult result={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders decision badge and the policy-element trace', () => {
    render(<AnnotatedResult result={{
      decision: 'PERMIT', effect: 'PERMIT',
      trace: { policySet: 'Account Access', rule: 'Region match', condition: 'user.region == EU', effect: 'PERMIT', statements: [{ type: 'ADVICE', detail: 'logged' }] },
      obligations: [], statements: [{ type: 'ADVICE', detail: 'logged' }], raw: { engine: 'simulated-learning' },
    }} />);
    expect(screen.getByText('PERMIT')).toBeInTheDocument();
    expect(screen.getByText('Account Access')).toBeInTheDocument();
    expect(screen.getByText('Region match')).toBeInTheDocument();
    expect(screen.getByText(/user\.region == EU/)).toBeInTheDocument();
  });

  test('renders filtered output when present', () => {
    render(<AnnotatedResult result={{
      decision: 'PERMIT', effect: 'PERMIT',
      trace: { policySet: 'x', rule: 'y', condition: 'z', effect: 'PERMIT', statements: [] },
      obligations: [], statements: [], output: { name: 'Ada', ssn: '***-**-6789' }, raw: {},
    }} />);
    expect(screen.getByText(/Filtered payload/i)).toBeInTheDocument();
    expect(screen.getByText(/\*\*\*-\*\*-6789/)).toBeInTheDocument();
  });
});
