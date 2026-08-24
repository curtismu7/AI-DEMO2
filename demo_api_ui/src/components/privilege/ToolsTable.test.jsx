import { fireEvent, render, screen } from '@testing-library/react';
import ToolsTable from './ToolsTable';

const tool = {
  name: 'search_records',
  description: 'Search records',
  inputSchema: {
    type: 'object',
    properties: {
      includeArchived: { type: 'boolean' },
      query: { type: 'string' },
    },
  },
};

const accountsTool = {
  name: 'get_my_accounts',
  description: 'List accounts',
  inputSchema: {
    type: 'object',
    properties: {
      account_type: {
        type: 'string',
        enum: ['checking', 'savings', 'loan', 'credit', 'investment'],
      },
    },
  },
};

const withRequiredEnum = {
  name: 'get_account_balance',
  description: 'Balance for one account',
  inputSchema: {
    type: 'object',
    properties: {
      account_id: {
        type: 'string',
        enum: ['acct-1', 'acct-2'],
      },
    },
    required: ['account_id'],
  },
};

describe('ToolsTable', () => {
  test('seeds boolean arguments with a JSON boolean', () => {
    render(<ToolsTable tools={[tool]} onExecute={vi.fn()} />);

    fireEvent.click(screen.getByText('search_records'));

    expect(screen.getByRole('textbox', { name: 'Arguments (JSON)' })).toHaveValue(JSON.stringify({ includeArchived: false, query: '' }, null, 2));
  });

  test('renders JSON results with syntax highlighting', async () => {
    render(<ToolsTable tools={[tool]} onExecute={vi.fn().mockResolvedValue('{"ok":true}')} />);

    fireEvent.click(screen.getByText('search_records'));
    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));

    expect(await screen.findByText('"ok":')).toHaveClass('jh-key');
    expect(screen.getByText('true')).toHaveClass('jh-keyword');
  });

  test('renders a dropdown for an enum parameter and writes the selection into the args JSON', () => {
    render(<ToolsTable tools={[accountsTool]} onExecute={vi.fn()} />);

    fireEvent.click(screen.getByText('get_my_accounts'));
    const select = screen.getByRole('combobox');
    expect(select).toHaveDisplayValue('(none)');

    fireEvent.change(select, { target: { value: 'checking' } });

    expect(screen.getByRole('textbox', { name: 'Arguments (JSON)' })).toHaveValue(
      JSON.stringify({ account_type: 'checking' }, null, 2),
    );
  });

  test('disables Execute and warns when a required enum parameter is blank', () => {
    render(<ToolsTable tools={[withRequiredEnum]} onExecute={vi.fn()} />);

    fireEvent.click(screen.getByText('get_account_balance'));

    expect(screen.getByText(/Missing required: account_id/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'acct-1' } });

    expect(screen.queryByText(/Missing required/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled();
  });
});
