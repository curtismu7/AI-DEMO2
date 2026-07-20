// demo_api_ui/src/components/shared/__tests__/InspectorTabs.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InspectorTabs from '../InspectorTabs';

const TABS = [
  { key: 'response', label: 'Response' },
  { key: 'request', label: 'Request' },
  { key: 'history', label: 'History' },
];

describe('InspectorTabs', () => {
  it('renders every tab label', () => {
    render(<InspectorTabs tabs={TABS} activeKey="response" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Response' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  it('marks only the active tab with the active class', () => {
    render(<InspectorTabs tabs={TABS} activeKey="request" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Response' })).not.toHaveClass(
      'inspector-shell-output-tab--active',
    );
    expect(screen.getByRole('button', { name: 'Request' })).toHaveClass(
      'inspector-shell-output-tab--active',
    );
  });

  it('calls onChange with the clicked tab key', () => {
    const onChange = vi.fn();
    render(<InspectorTabs tabs={TABS} activeKey="response" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(onChange).toHaveBeenCalledWith('history');
  });

  it('renders nothing when tabs is empty', () => {
    const { container } = render(<InspectorTabs tabs={[]} activeKey="" onChange={() => {}} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
