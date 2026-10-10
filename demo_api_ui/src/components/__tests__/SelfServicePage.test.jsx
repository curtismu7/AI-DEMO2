/**
 * SelfServicePage — the registration form mirrors the server's rules
 * (routes/selfServiceUsers.js): email must be @pingidentity.com or
 * @pingone.com without plus-addressing, and a phone number is required
 * (it is enrolled as an MFA device).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SelfServicePage from '../SelfServicePage';

// Inputs carry placeholders except first/last name; all share .ssp-input and
// appear in the form in this order.
const type = (input, value) => fireEvent.change(input, { target: { value } });

async function fillForm({ email = 'new.user@pingidentity.com', phone = '+12065551234' } = {}) {
  const { container } = render(
    <MemoryRouter>
      <SelfServicePage />
    </MemoryRouter>,
  );
  const inputs = container.querySelectorAll('.ssp-input');
  // Order in the form: firstName, lastName, email, username, password, confirmPassword, phone
  type(inputs[0], 'New');
  type(inputs[1], 'User');
  type(inputs[2], email);
  type(inputs[3], 'newuser');
  type(inputs[4], 'Password1');
  type(inputs[5], 'Password1');
  type(inputs[6], phone);
  // The submit button (the tab strip also has a "Create Account" tab).
  const submit = [...container.querySelectorAll('.ssp-submit-btn')].find((b) => /create account/i.test(b.textContent));
  return { container, submit };
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: async () => ({}) }));
});

describe('SelfServicePage registration validation', () => {
  test.each([
    ['user+p1@pingone.com', 'plus-addressing'],
    ['someone@gmail.com', 'must be @pingidentity\\.com or @pingone\\.com'],
  ])('rejects %s with a rule-naming message', async (bad, fragment) => {
    const { container, submit } = await fillForm({ email: bad });
    fireEvent.click(submit);
    expect(container.textContent).toMatch(new RegExp(fragment, 'i'));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('empty phone blocks submission with a required-phone message', async () => {
    const { container, submit } = await fillForm({ phone: '' });
    fireEvent.click(submit);
    expect(container.textContent).toMatch(/phone is required/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('valid form submits to /api/self-service/users with phone', async () => {
    const { submit } = await fillForm();
    fireEvent.click(submit);
    await Promise.resolve();
    const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/self-service/users'));
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1].body).phone).toBe('+12065551234');
  });
});
