import { render, screen } from '@testing-library/react';
import { A2A_RECORDED_RUN } from '../../data/a2aRecordedRun';
import A2AFlowVisualizer from '../A2AFlowVisualizer';

class RO { observe() {} unobserve() {} disconnect() {} }
window.ResizeObserver = window.ResizeObserver || RO;
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class {};

it('pingStyle renders the Ping figure, the step bar and the evidence list', () => {
  render(<A2AFlowVisualizer pingStyle tokenEvents={A2A_RECORDED_RUN.tokenEvents} />);
  expect(screen.getByTestId('a2a-learn-diagram').classList.contains('sfd--ping')).toBe(true);
  expect(screen.getByTestId('a2a-learn-steps')).toBeTruthy();
  expect(document.querySelector('[data-testid="a2t-token-flow-diagram"]')).toBeNull();
  expect(document.querySelectorAll('.a2fv-evidence-item').length).toBeGreaterThan(0);
});
