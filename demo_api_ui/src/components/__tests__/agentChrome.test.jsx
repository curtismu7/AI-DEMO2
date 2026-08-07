import { fireEvent, render, screen } from '@testing-library/react';
import { ClarifyOptions } from '../agentChrome';

describe('ClarifyOptions', () => {
  it('renders plain string options', () => {
    render(<ClarifyOptions options={['Checking', 'Savings']} onSelect={() => {}} active={true} />);
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
  });

  it('renders rich options showing label', () => {
    const opts = [
      { label: 'Checking ••6789', value: 'checking' },
      { label: 'Savings ••4521', value: 'savings' },
    ];
    render(<ClarifyOptions options={opts} onSelect={() => {}} active={true} />);
    expect(screen.getByText(/Checking ••6789/)).toBeInTheDocument();
    expect(screen.getByText(/Savings ••4521/)).toBeInTheDocument();
  });

  it('calls onSelect with value (not label) for rich options', () => {
    const onSelect = vi.fn();
    const opts = [{ label: 'Checking ••6789', value: 'checking' }];
    render(<ClarifyOptions options={opts} onSelect={onSelect} active={true} />);
    fireEvent.click(screen.getByText(/Checking/));
    expect(onSelect).toHaveBeenCalledWith('checking');
  });

  it('calls onSelect with the string for plain options', () => {
    const onSelect = vi.fn();
    render(<ClarifyOptions options={['Savings']} onSelect={onSelect} active={true} />);
    fireEvent.click(screen.getByText('Savings'));
    expect(onSelect).toHaveBeenCalledWith('savings');
  });

  it('disables buttons when active=false', () => {
    render(<ClarifyOptions options={['Checking']} onSelect={() => {}} active={false} />);
    expect(screen.getByRole('option', { name: /Checking/ })).toBeDisabled();
  });
});
