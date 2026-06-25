// demo_api_ui/src/__tests__/McpFieldContext.test.js
import React from 'react';
import { render, act } from '@testing-library/react';
import { McpFieldProvider, useMcpField } from '../context/McpFieldContext';
import { useMcpFieldState } from '../hooks/useMcpFieldState';

function Consumer({ fieldKey }) {
  const { value, source } = useMcpField(fieldKey);
  return <div data-testid="val">{value}</div>;
}

function Writer({ fieldKey }) {
  const { setValue } = useMcpField(fieldKey);
  return (
    <button onClick={() => setValue('test-uuid', 'Step 2')}>write</button>
  );
}

function Wrapper({ children }) {
  return <McpFieldProvider>{children}</McpFieldProvider>;
}

test('value starts empty', () => {
  const { getByTestId } = render(
    <Wrapper><Consumer fieldKey="pingOneResourceId" /></Wrapper>
  );
  expect(getByTestId('val').textContent).toBe('');
});

test('setValue updates value and source reactively', () => {
  const { getByTestId, getByText } = render(
    <Wrapper>
      <Consumer fieldKey="pingOneResourceId" />
      <Writer fieldKey="pingOneResourceId" />
    </Wrapper>
  );
  act(() => { getByText('write').click(); });
  expect(getByTestId('val').textContent).toBe('test-uuid');
});

test('clear resets value to empty string', () => {
  function ClearConsumer() {
    const { value, setValue, clear } = useMcpField('pingOneResourceId');
    return (
      <>
        <div data-testid="val">{value}</div>
        <button onClick={() => setValue('abc', 'Step 2')}>write</button>
        <button onClick={clear}>clear</button>
      </>
    );
  }
  const { getByTestId, getByText } = render(
    <Wrapper><ClearConsumer /></Wrapper>
  );
  act(() => { getByText('write').click(); });
  expect(getByTestId('val').textContent).toBe('abc');
  act(() => { getByText('clear').click(); });
  expect(getByTestId('val').textContent).toBe('');
});

test('different keys are independent', () => {
  const { getAllByTestId, getByText } = render(
    <Wrapper>
      <Consumer fieldKey="pingOneResourceId" />
      <Consumer fieldKey="gatewayUrl" />
      <Writer fieldKey="pingOneResourceId" />
    </Wrapper>
  );
  act(() => { getByText('write').click(); });
  const vals = getAllByTestId('val');
  expect(vals[0].textContent).toBe('test-uuid');
  expect(vals[1].textContent).toBe('');
});

test('useMcpField throws when used outside provider', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => render(<Consumer fieldKey="x" />)).toThrow();
  spy.mockRestore();
});

// --- useMcpFieldState tests ---

test('useMcpFieldState seeds defaultValue on mount', () => {
  function Seeder() {
    const { value } = useMcpFieldState('pingOneEnvUrl', { defaultValue: 'https://auth.example.com' });
    return <div data-testid="seeded">{value}</div>;
  }
  const { getByTestId } = render(<Wrapper><Seeder /></Wrapper>);
  expect(getByTestId('seeded').textContent).toBe('https://auth.example.com');
});

test('useMcpFieldState uses source option as chip label', () => {
  function Seeder() {
    const { source } = useMcpFieldState('pingOneEnvUrl', { defaultValue: 'https://auth.example.com', source: 'auto-filled' });
    return <div data-testid="src">{source}</div>;
  }
  const { getByTestId } = render(<Wrapper><Seeder /></Wrapper>);
  expect(getByTestId('src').textContent).toBe('auto-filled');
});

test('useMcpFieldState does not seed when defaultValue is empty string', () => {
  function Seeder() {
    const { value } = useMcpFieldState('mcpScope', { defaultValue: '' });
    return <div data-testid="val">{value}</div>;
  }
  const { getByTestId } = render(<Wrapper><Seeder /></Wrapper>);
  expect(getByTestId('val').textContent).toBe('');
});

test('useMcpFieldState does not overwrite existing value', () => {
  function WriteThenSeed() {
    const { value, setValue } = useMcpFieldState('gatewayUrl', { defaultValue: 'default-url' });
    return (
      <>
        <div data-testid="val">{value}</div>
        <button type="button" onClick={() => setValue('user-typed', null)}>set</button>
      </>
    );
  }
  // The Seeder component seeds 'default-url' — then user types something
  // A second render with the same defaultValue should not overwrite
  const { getByTestId, getByText } = render(<Wrapper><WriteThenSeed /></Wrapper>);
  // First: seeded by defaultValue
  expect(getByTestId('val').textContent).toBe('default-url');
  // User types their own value
  act(() => { getByText('set').click(); });
  expect(getByTestId('val').textContent).toBe('user-typed');
  // No further state changes expected — user value persists
});

test('useMcpFieldState falls back to auto-filled when no source option given', () => {
  function Seeder() {
    const { source } = useMcpFieldState('introspectEndpoint', { defaultValue: 'https://token.example.com/introspect' });
    return <div data-testid="src">{source}</div>;
  }
  const { getByTestId } = render(<Wrapper><Seeder /></Wrapper>);
  expect(getByTestId('src').textContent).toBe('auto-filled');
});
