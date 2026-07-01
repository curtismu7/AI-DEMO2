// demo_api_ui/src/components/authz/DemoForm.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import DemoForm from './DemoForm';

const fields = [
  { name: 'amount', label: 'Amount (USD)', type: 'number', default: 1000 },
  { name: 'type', label: 'Transaction type', type: 'select', options: ['transfer', 'deposit'], default: 'transfer' },
];

describe('DemoForm', () => {
  test('renders a control per field', () => {
    render(<DemoForm fields={fields} values={{ amount: 1000, type: 'transfer' }} onChange={() => {}} />);
    expect(screen.getByLabelText('Amount (USD)')).toBeInTheDocument();
    expect(screen.getByLabelText('Transaction type')).toBeInTheDocument();
  });

  test('calls onChange with name and value', () => {
    const onChange = vi.fn();
    render(<DemoForm fields={fields} values={{ amount: 1000, type: 'transfer' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Amount (USD)'), { target: { value: '5000' } });
    expect(onChange).toHaveBeenCalledWith('amount', '5000');
  });
});
