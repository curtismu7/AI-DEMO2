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

describe('ClarifyOptions — amountOptions', () => {
  it('renders amount buttons when amountOptions provided', () => {
    render(
      <ClarifyOptions
        options={['Checking']}
        amountOptions={[100, 500, 1000]}
        onSelect={() => {}}
        active={true}
      />
    );
    expect(screen.getByText('$100')).toBeInTheDocument();
    expect(screen.getByText('$500')).toBeInTheDocument();
    expect(screen.getByText('$1,000')).toBeInTheDocument();
  });

  it('calls onSelect with "$500" when amount button clicked', () => {
    const onSelect = vi.fn();
    render(
      <ClarifyOptions
        options={[]}
        amountOptions={[500]}
        onSelect={onSelect}
        active={true}
      />
    );
    fireEvent.click(screen.getByText('$500'));
    expect(onSelect).toHaveBeenCalledWith('$500');
  });

  it('disables amount buttons when active=false', () => {
    render(
      <ClarifyOptions
        options={[]}
        amountOptions={[100]}
        onSelect={() => {}}
        active={false}
      />
    );
    expect(screen.getByRole('option', { name: '$100' })).toBeDisabled();
  });
});

describe('ClarifyOptions — keyboard nav', () => {
  it('moves focus right on ArrowRight', () => {
    render(
      <ClarifyOptions
        options={['Checking', 'Savings']}
        onSelect={() => {}}
        active={true}
      />
    );
    const btns = screen.getAllByRole('option');
    btns[0].focus();
    fireEvent.keyDown(btns[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(btns[1]);
  });

  it('wraps from last to first on ArrowRight', () => {
    render(
      <ClarifyOptions
        options={['A', 'B']}
        onSelect={() => {}}
        active={true}
      />
    );
    const btns = screen.getAllByRole('option');
    btns[1].focus();
    fireEvent.keyDown(btns[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(btns[0]);
  });

  it('calls onDismiss on Escape', () => {
    const onDismiss = vi.fn();
    render(
      <ClarifyOptions
        options={['A']}
        onSelect={() => {}}
        active={true}
        onDismiss={onDismiss}
      />
    );
    const btn = screen.getByRole('option', { name: 'A' });
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });
});
