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
});
