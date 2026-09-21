import { useState } from 'react';
import apiClient from '../services/apiClient';

export default function HostedRegistrationPage() {
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', phone: '' });
  const [requestId, setRequestId] = useState('');
  const [otp, setOtp] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function submitRequest(event) {
    event.preventDefault();
    setError('');
    try {
      const response = await apiClient.post('/api/auth/hosted-registration/request', form);
      setRequestId(response.data.requestId);
      setStatus('otp_pending');
    } catch (err) {
      setError(err.response?.data?.error === 'pingidentity_email_required'
        ? 'Use your @pingidentity.com email address.'
        : 'We could not start registration. Please try again.');
    }
  }

  async function verifyEmail(event) {
    event.preventDefault();
    setError('');
    try {
      const response = await apiClient.post('/api/auth/hosted-registration/verify', { requestId, otp });
      setStatus(response.data.status);
    } catch (err) {
      setError('That code was not accepted. Request a new code or try again.');
    }
  }

  return (
    <main className="hosted-registration-page" style={{ maxWidth: 560, margin: '4rem auto', padding: '2rem' }}>
      <h1>Request hosted demo access</h1>
      {status === 'pending_approval' ? (
        <p role="status">Your email is verified. Your request is awaiting administrator approval.</p>
      ) : status === 'otp_pending' ? (
        <form onSubmit={verifyEmail}>
          <p>We sent a one-time code to your PingIdentity email address.</p>
          <label htmlFor="registration-otp">Verification code</label>
          <input id="registration-otp" value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
          <button type="submit">Verify email</button>
        </form>
      ) : (
        <form onSubmit={submitRequest}>
          <label htmlFor="registration-email">PingIdentity email</label>
          <input id="registration-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@pingidentity.com" required />
          <label htmlFor="registration-first-name">First name</label>
          <input id="registration-first-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required />
          <label htmlFor="registration-last-name">Last name</label>
          <input id="registration-last-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required />
          <label htmlFor="registration-phone">Cell phone</label>
          <input id="registration-phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+1 214 555 0123" autoComplete="tel" required />
          <button type="submit">Send verification code</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
