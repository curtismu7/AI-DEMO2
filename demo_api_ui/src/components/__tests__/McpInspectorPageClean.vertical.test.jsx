// MCP Inspector tools table: every tool the server returns in one searchable table
// (no Vertical / Tool dropdowns); picking a row selects it and fills the ?vertical=
// sample args.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendMcpCall, getCalls } from '../../services/mcpCallStore';

const sourceState = { current: null };
vi.mock('../../hooks/useInspectorSource', () => ({
  useInspectorSource: () => sourceState.current,
}));
vi.mock('../../context/InspectorFieldContext', () => ({
  useInspectorFields: () => ({ registerFields: vi.fn(), getMatchingFields: () => ({}) }),
  InspectorFieldProvider: ({ children }) => children,
}));

vi.mock('../../utils/authUi', () => ({ navigateToCustomerOAuthLogin: vi.fn() }));
import { navigateToCustomerOAuthLogin } from '../../utils/authUi';
import McpInspectorPageClean from '../McpInspectorPageClean';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCHEMA_TOOLS = Object.keys(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../mcp-tool-schemas.json'), 'utf8')).tools);

// The leak the ownership rule closes: with every MCP tool listed by the server, a
// non-banking vertical shows no banking-only tool and no other vertical's API-key
// tool, but does show its own and the global ones.
const BANKING_ONLY = ['show_mortgage', 'get_fee_schedule', 'search_transactions', 'get_investment_accounts', 'adjust_balance', 'freeze_account', 'delete_customer', 'reset_customer_password'];
const OTHER_MCP_TOOLS = ['show_permit', 'show_work_order', 'show_expense_report', 'show_gear_order', 'show_enrollment', 'show_investment', 'show_large_purchase', 'list_walbuy_orders'];
const GLOBALS = ['sequential_think', 'get_weather', 'brave_news_search', 'code_search', 'list_verticals', 'call_pingone_tool', 'list_pingone_tools', 'jwt_decode_full'];

const schema = (props) => ({ type: 'object', properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])) });
const TOOLS = [
  { name: 'get_my_accounts', inputSchema: schema(['account_type']) },
  { name: 'create_withdrawal', inputSchema: schema(['from_account_id', 'amount']) },
  { name: 'view_records', inputSchema: schema([]) },
  { name: 'pay_bill', inputSchema: schema(['billId', 'amount']) },
  { name: 'sequential_think', inputSchema: schema(['query']) },
];

function makeSource(selectedTool = null) {
  return {
    tools: TOOLS, loadingTools: false, selectedTool, setSelectedTool: vi.fn(), setParamValues: vi.fn(),
    schemaProps: selectedTool?.inputSchema.properties ?? {}, requiredParams: new Set(), paramValues: {}, busy: false, handleExecute: vi.fn(),
    mcpHistory: getCalls(), mode: 'tools', banner: null, servers: [], profiles: [], selectedProfileId: '',
    setSelectedProfileId: vi.fn(), loadTools: vi.fn(), lastInvoke: null, toolsSource: 'mcp_server',
    pendingElicitation: null, answerElicitation: vi.fn(),
    config: { toolKey: 'name', paramsKey: 'tool' },
  };
}

const renderAt = (url) => render(<MemoryRouter initialEntries={[url]}><McpInspectorPageClean /></MemoryRouter>);
const toolNames = () => [...document.querySelectorAll('.insp-tools__pick')].map((b) => b.textContent);
const pickTool = (name) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => { sourceState.current = makeSource(); });

describe('MCP Inspector tools table', () => {
  it('lists every tool the server returned in one table — no Vertical or Tool dropdown', () => {
    renderAt('/');
    expect(toolNames()).toEqual(TOOLS.map((t) => t.name));
    expect(screen.queryByLabelText('Vertical')).toBeNull();
    expect(screen.queryByLabelText('Tool')).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('lists the whole server catalog, whichever vertical ?vertical= names', () => {
    sourceState.current = { ...makeSource(), tools: SCHEMA_TOOLS.map((name) => ({ name, inputSchema: schema([]) })) };
    renderAt('/?vertical=healthcare');
    expect(toolNames()).toHaveLength(SCHEMA_TOOLS.length);
    expect(toolNames()).toContain('show_health_record');
    for (const t of [...BANKING_ONLY, ...OTHER_MCP_TOOLS]) expect(toolNames(), t).toContain(t);
  });

  it('picking a row selects that tool and fills the vertical\'s sample args', () => {
    renderAt('/?vertical=healthcare');
    pickTool('pay_bill');
    expect(sourceState.current.setSelectedTool).toHaveBeenLastCalledWith(TOOLS[3]);
    expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({ amount: '650' });
  });

  it('defaults to banking args, and an unknown ?vertical= falls back to banking', () => {
    renderAt('/?vertical=nope');
    pickTool('create_withdrawal');
    expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({});
  });

  it('search narrows the table by name, description or scope and says how many matched', () => {
    sourceState.current = { ...makeSource(), tools: TOOLS.map((t) => ({ ...t, description: t.name === 'pay_bill' ? 'Pay a medical bill' : '', requiredScopes: t.name === 'view_records' ? ['records:read'] : [] })) };
    renderAt('/');
    fireEvent.change(screen.getByRole('searchbox', { name: /search tools/i }), { target: { value: 'medical' } });
    expect(toolNames()).toEqual(['pay_bill']);
    expect(screen.getByText('1 of 5')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: /search tools/i }), { target: { value: 'records:read' } });
    expect(toolNames()).toEqual(['view_records']);
    fireEvent.change(screen.getByRole('searchbox', { name: /search tools/i }), { target: { value: 'zzz' } });
    expect(screen.getByText(/No tools match/)).toBeTruthy();
  });

  it('marks the picked tool\'s row and shows its name with the parameters', () => {
    sourceState.current = makeSource(TOOLS[0]);
    renderAt('/');
    expect(screen.getByRole('button', { name: 'get_my_accounts', pressed: true })).toBeTruthy();
    expect(screen.getByLabelText(/account_type/)).toBeTruthy();
    expect(screen.queryByText(/Pick a tool above/)).toBeNull();
  });

  it('asks you to pick a tool until one is picked', () => {
    renderAt('/');
    expect(screen.getByText(/Pick a tool above/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('a column a source never fills is dropped (no scopes: no Scopes column)', () => {
    renderAt('/');
    expect(screen.queryByRole('columnheader', { name: 'Scopes' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Description' })).toBeNull();
  });

  it('Edit and Resend still load the call\'s own tool after a vertical change', async () => {
    appendMcpCall('get_my_accounts', 200, 5, {}, null, { src: 'you', params: { account_type: 'checking' } });
    sourceState.current = makeSource();
    renderAt('/?vertical=healthcare');
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(sourceState.current.setSelectedTool).toHaveBeenCalledWith(TOOLS[0]);
    expect(sourceState.current.setParamValues).toHaveBeenCalledWith({ account_type: 'checking' });
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(sourceState.current.handleExecute).toHaveBeenCalledWith({ tool: TOOLS[0], params: { account_type: 'checking' } }));
  });

  it('says the local fallback only serves banking when another vertical is picked', () => {
    const NOTE = 'The local fallback only serves banking tools.';
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog' };
    const { unmount } = renderAt('/?vertical=healthcare');
    expect(screen.getByRole('status')).toHaveTextContent(NOTE);
    unmount();
    const { unmount: unmountBanking } = renderAt('/');
    expect(screen.getByRole('status')).not.toHaveTextContent('only serves banking');
    unmountBanking();
    sourceState.current = makeSource();
    renderAt('/?vertical=healthcare');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers a log-in button that returns to the inspector whenever the tool list is the local fallback', () => {
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog' };
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /log in again/i }));
    expect(navigateToCustomerOAuthLogin).toHaveBeenCalledWith(window.location.pathname);
    sourceState.current = makeSource();
  });

  it('tells a PingFederate session that live tools need the P1 login, with no useless log-in button', () => {
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog', toolsReason: 'token_resolve_failed_agent_not_authorized_by_user', toolsProvider: 'pingfederate' };
    renderAt('/');
    expect(screen.getByRole('status')).toHaveTextContent('only work with the PingOne (P1) login');
    expect(screen.queryByRole('button', { name: /log in again/i })).toBeNull();
    sourceState.current = makeSource();
  });

  it('says why the tool list fell back, and offers no log-in when the server is simply unreachable', () => {
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog', toolsReason: 'token_resolve_failed_TOKEN_INACTIVE' };
    const { unmount } = renderAt('/');
    expect(screen.getByRole('status')).toHaveTextContent('Your token was rejected (TOKEN_INACTIVE).');
    expect(screen.getByRole('button', { name: /log in again/i })).toBeTruthy();
    unmount();
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog', toolsReason: 'token_resolve_failed_actor_token_invalid' };
    const { unmount: unmountActor } = renderAt('/');
    expect(screen.getByRole('status')).toHaveTextContent('not your login');
    expect(screen.queryByRole('button', { name: /log in again/i })).toBeNull();
    unmountActor();
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog', toolsReason: 'mcp_unreachable: ECONNREFUSED' };
    renderAt('/');
    expect(screen.getByRole('status')).toHaveTextContent('could not be reached');
    expect(screen.queryByRole('button', { name: /log in again/i })).toBeNull();
    sourceState.current = makeSource();
  });

  describe('defaults that make a bare Send work', () => {
    const WEATHER = { name: 'get_weather', inputSchema: schema(['city_name', 'latitude', 'longitude', 'location_name']) };
    const withWeather = (extra = {}) => ({ ...makeSource(), tools: [{ name: 'brave_news_search', inputSchema: schema(['query']) }, WEATHER], ...extra });

    it('pre-selects get_my_accounts on the AI Demo source, so Send works straight away', () => {
      renderAt('/');
      expect(sourceState.current.setSelectedTool).toHaveBeenCalledTimes(1);
      expect(sourceState.current.setSelectedTool).toHaveBeenCalledWith(TOOLS[0]);
    });

    it('on the gateway it pre-selects the weather tool and fills city_name with Austin, TX (Texas)', () => {
      sourceState.current = withWeather();
      renderAt('/?source=gateway');
      expect(sourceState.current.setSelectedTool).toHaveBeenCalledWith(WEATHER);
      expect(sourceState.current.setParamValues).toHaveBeenCalledWith({ city_name: 'Austin, TX' });
    });

    it('picking the weather tool by hand fills the same default, and never the coordinates or saved location', () => {
      sourceState.current = withWeather({ selectedTool: TOOLS[0] });
      renderAt('/?source=gateway');
      fireEvent.click(screen.getByRole('button', { name: 'get_weather' }));
      expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({ city_name: 'Austin, TX' });
    });

    it('leaves a tool without a known default alone', () => {
      sourceState.current = withWeather({ selectedTool: WEATHER });
      renderAt('/?source=gateway');
      fireEvent.click(screen.getByRole('button', { name: 'brave_news_search' }));
      expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({});
    });

    it('does not override something already selected', () => {
      sourceState.current = makeSource(TOOLS[1]);
      renderAt('/');
      expect(sourceState.current.setSelectedTool).not.toHaveBeenCalled();
    });

    it('pre-selects once, then leaves the user alone even if the selection is cleared by a reload', () => {
      const first = makeSource();
      sourceState.current = first;
      const { rerender } = renderAt('/');
      expect(first.setSelectedTool).toHaveBeenCalledTimes(1);
      sourceState.current = { ...first, tools: [...TOOLS] };
      rerender(<MemoryRouter initialEntries={['/']}><McpInspectorPageClean /></MemoryRouter>);
      expect(first.setSelectedTool).toHaveBeenCalledTimes(1);
    });

    it('waits for tools that belong to THIS source: stale tools from the previous source must not use up the pick', () => {
      const first = { ...makeSource(), toolsKey: 'api:' };
      sourceState.current = first;
      const { rerender } = renderAt('/?source=gateway');
      expect(first.setSelectedTool).not.toHaveBeenCalled();
      // the gateway tools arrive: now it picks the weather tool
      const WEATHER = { name: 'get_weather_summary', inputSchema: schema(['city_name']) };
      const arrived = { ...first, tools: [WEATHER], toolsKey: 'gateway:' };
      sourceState.current = arrived;
      rerender(<MemoryRouter initialEntries={['/?source=gateway']}><McpInspectorPageClean /></MemoryRouter>);
      expect(arrived.setSelectedTool).toHaveBeenCalledWith(WEATHER);
      expect(arrived.setParamValues).toHaveBeenCalledWith({ city_name: 'Austin, TX' });
    });

    it('selects nothing in the calls log, while tools are still loading, or when no preferred tool is offered', () => {
      sourceState.current = { ...makeSource(), mode: 'calls', config: { toolKey: 'label' }, tools: [{ label: 'GET /api/x', _call: { method: 'GET', url: '/api/x', response: { status: 200 } } }] };
      renderAt('/?source=api');
      expect(sourceState.current.setSelectedTool).not.toHaveBeenCalled();
      sourceState.current = { ...makeSource(), loadingTools: true };
      renderAt('/');
      expect(sourceState.current.setSelectedTool).not.toHaveBeenCalled();
      sourceState.current = { ...makeSource(), tools: [{ name: 'create_deposit', inputSchema: schema(['amount']) }] };
      renderAt('/');
      expect(sourceState.current.setSelectedTool).not.toHaveBeenCalled();
    });
  });

  describe('loading spinner', () => {
    it('shows a labelled spinner, not a blank card or bare text, while the tools load', () => {
      sourceState.current = { ...makeSource(), tools: [], loadingTools: true };
      renderAt('/');
      const spinner = screen.getByRole('status', { name: 'Loading tools…' });
      expect(spinner).toBeInTheDocument();
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('also covers the moment before the load has started (toolsKey still null)', () => {
      sourceState.current = { ...makeSource(), tools: [], loadingTools: false, toolsKey: null };
      renderAt('/');
      expect(screen.getByRole('status', { name: 'Loading tools…' })).toBeInTheDocument();
    });

    it('says methods for the Raw JSON-RPC source', () => {
      sourceState.current = { ...makeSource(), tools: [], loadingTools: true, config: { toolKey: 'method', paramsKey: 'method' } };
      renderAt('/?source=protocol');
      expect(screen.getByRole('status', { name: 'Loading methods…' })).toBeInTheDocument();
    });

    it('goes away once the tools have loaded', () => {
      sourceState.current = { ...makeSource(), loadingTools: false, toolsKey: 'banking:' };
      renderAt('/');
      expect(screen.queryByRole('status', { name: /Loading tools/ })).toBeNull();
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('keeps the table and shows a small "Refreshing" spinner while a reload is in flight', () => {
      sourceState.current = { ...makeSource(), loadingTools: true };
      renderAt('/');
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Refreshing tools…' })).toBeInTheDocument();
      expect(screen.getByLabelText('tools', { selector: 'section' })).toHaveAttribute('aria-busy', 'true');
    });

    it('does not spin forever when there is nothing to load: no server profile yet, or a load that already finished empty', () => {
      sourceState.current = { ...makeSource(), tools: [], mode: 'profiles', selectedProfileId: '', toolsKey: null };
      renderAt('/?source=custom');
      expect(screen.queryByRole('status', { name: /Loading/ })).toBeNull();
      sourceState.current = { ...makeSource(), tools: [], toolsKey: 'banking:' };
      renderAt('/');
      expect(screen.queryByRole('status', { name: /Loading/ })).toBeNull();
    });
  });

  describe('weather location choice', () => {
    const FULL = { name: 'get_weather_summary', inputSchema: schema(['latitude', 'longitude', 'location_name', 'city_name', 'include', 'days', 'units']) };
    const withValues = (paramValues) => ({ ...makeSource(FULL), tools: [FULL], paramValues, schemaProps: FULL.inputSchema.properties });
    const visible = () => [...document.querySelectorAll('.insp-send-row > .insp-field > span, .insp-send-row > label.insp-field > span')].map((e) => e.textContent);

    it('offers City / Coordinates / Saved location as radios, City checked, and shows only the city field', () => {
      sourceState.current = withValues({ city_name: 'Austin, TX' });
      renderAt('/?source=gateway');
      expect(screen.getByRole('radio', { name: 'City' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Coordinates' })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: 'Saved location' })).not.toBeChecked();
      expect(screen.getByLabelText('city_name')).toHaveValue('Austin, TX');
      expect(screen.queryByLabelText('latitude')).toBeNull();
      expect(screen.queryByLabelText('location_name')).toBeNull();
    });

    it('folds the other optional settings under "More options", closed by default', () => {
      sourceState.current = withValues({ city_name: 'Austin, TX' });
      renderAt('/?source=gateway');
      const more = screen.getByText('More options (3)').closest('details');
      expect(more).not.toHaveAttribute('open');
      expect(more).toContainElement(screen.getByLabelText('days'));
    });

    it('choosing Coordinates clears the city and fills Austin\'s coordinates', () => {
      sourceState.current = withValues({ city_name: 'Austin, TX' });
      renderAt('/?source=gateway');
      fireEvent.click(screen.getByRole('radio', { name: 'Coordinates' }));
      expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({ latitude: '30.2672', longitude: '-97.7431' });
      expect(screen.getByLabelText('latitude')).toBeInTheDocument();
      expect(screen.getByLabelText('longitude')).toBeInTheDocument();
      expect(screen.queryByLabelText('city_name')).toBeNull();
    });

    it('says a saved location is always denied, and clears whatever was filled', () => {
      sourceState.current = withValues({ city_name: 'Austin, TX' });
      renderAt('/?source=gateway');
      fireEvent.click(screen.getByRole('radio', { name: 'Saved location' }));
      expect(screen.getByText(/always denied by the demo policy/)).toBeInTheDocument();
      expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({});
      expect(screen.getByLabelText('location_name')).toBeInTheDocument();
    });

    it('an Edit/Resend that restored coordinates opens on Coordinates, not City', () => {
      sourceState.current = withValues({ latitude: '47.6', longitude: '-122.3' });
      renderAt('/?source=gateway');
      expect(screen.getByRole('radio', { name: 'Coordinates' })).toBeChecked();
    });

    it('when values for more than one alternative are present it hides nothing (never silently sends a hidden value)', () => {
      sourceState.current = withValues({ city_name: 'Austin', latitude: '30' });
      renderAt('/?source=gateway');
      expect(screen.queryByRole('radio', { name: 'City' })).toBeNull();
      for (const f of ['city_name', 'latitude', 'longitude', 'location_name', 'days']) expect(screen.getByLabelText(f)).toBeInTheDocument();
    });

    it('a tool without the alternatives is unchanged: every field, no chooser, no More options', () => {
      sourceState.current = makeSource(TOOLS[1]);
      renderAt('/');
      expect(screen.queryByRole('radio')).toBeNull();
      expect(screen.queryByText(/More options/)).toBeNull();
      expect(screen.getByLabelText('from_account_id')).toBeInTheDocument();
    });
  });
});

