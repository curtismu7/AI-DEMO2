// demo_api_ui/src/__tests__/CopyableValue.test.js
import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { McpFieldProvider } from '../context/McpFieldContext';
import CopyableValue from '../components/CopyableValue';

// Mock clipboard
const writeText = jest.fn(() => Promise.resolve());
Object.assign(navigator, { clipboard: { writeText } });

function Wrapper({ children }) {
  return <McpFieldProvider>{children}</McpFieldProvider>;
}

test('renders label', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" />
    </Wrapper>
  );
  expect(getByText('Resource ID')).toBeTruthy();
});

test('shows required badge when required and empty', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" required />
    </Wrapper>
  );
  expect(getByText('required')).toBeTruthy();
});

test('does not show copy button when empty', () => {
  const { queryByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" required />
    </Wrapper>
  );
  expect(queryByText(/Copy/)).toBeNull();
});

test('shows copy button when value is present', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" defaultValue="abc-123" />
    </Wrapper>
  );
  expect(getByText('⎘ Copy')).toBeTruthy();
});

test('copy button writes value to clipboard', async () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue label="Resource ID" fieldKey="pingOneResourceId" defaultValue="abc-123" />
    </Wrapper>
  );
  fireEvent.click(getByText('⎘ Copy'));
  expect(writeText).toHaveBeenCalledWith('abc-123');
  await waitFor(() => expect(getByText('✅ Copied')).toBeTruthy());
});

test('shows source chip when source is set', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue
        label="Resource ID"
        fieldKey="pingOneResourceId"
        defaultValue="abc-123"
        defaultSource="Step 2"
      />
    </Wrapper>
  );
  expect(getByText('From Step 2')).toBeTruthy();
});

test('shows hint text when provided', () => {
  const { getByText } = render(
    <Wrapper>
      <CopyableValue
        label="Resource ID"
        fieldKey="pingOneResourceId"
        hint="Used in OAuth2ResourceServerFilter"
      />
    </Wrapper>
  );
  expect(getByText('Used in OAuth2ResourceServerFilter')).toBeTruthy();
});
