import { render, screen } from '@testing-library/react';
import MCPToolsListModal from '../components/MCPToolsListModal';

const authTool = { name: 'get_my_accounts', description: 'Get accounts', requiredScopes: ['read'] };
const publicTool = { name: 'list_account_types', description: 'List account types', requiredScopes: [] };

describe('MCPToolsListModal — auth-required indicator', () => {
  it('shows a lock icon for tools with requiredScopes', () => {
    render(<MCPToolsListModal show tools={[authTool]} onClose={() => {}} />);
    expect(screen.getByText('🔐')).toBeInTheDocument();
  });

  it('does not show a lock icon for public tools', () => {
    render(<MCPToolsListModal show tools={[publicTool]} onClose={() => {}} />);
    expect(screen.queryByText('🔐')).not.toBeInTheDocument();
  });
});
