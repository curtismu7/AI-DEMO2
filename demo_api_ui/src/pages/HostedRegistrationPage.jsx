import { useState } from 'react';
import apiClient from '../services/apiClient';

export default function HostedRegistrationPage() {
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', countryCode: '+1', phone: '' });
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
    <main className="hosted-registration-page">
      <section className="hosted-registration__card" aria-labelledby="hosted-registration-title">
        <div className="hosted-registration__eyebrow">PingOne hosted access</div>
        <h1 id="hosted-registration-title">Request hosted demo access</h1>
        <p className="hosted-registration__intro">Verify your PingIdentity email and an administrator will review your request.</p>
      {status === 'pending_approval' ? (
        <div className="hosted-registration__success" role="status">
          <strong>Email verified</strong>
          <p>Your request is awaiting administrator approval. We’ll email you when access is ready.</p>
        </div>
      ) : status === 'otp_pending' ? (
        <form className="hosted-registration__form" onSubmit={verifyEmail}>
          <p>We sent a one-time code to your PingIdentity email address.</p>
          <div className="hosted-registration__field">
            <label htmlFor="registration-otp">Verification code</label>
            <input className="hosted-registration__input hosted-registration__input--code" id="registration-otp" value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
          </div>
          <button className="hosted-registration__submit" type="submit">Verify email</button>
        </form>
      ) : (
        <form className="hosted-registration__form" onSubmit={submitRequest}>
          <div className="hosted-registration__field">
            <label htmlFor="registration-email">PingIdentity email</label>
            <input className="hosted-registration__input" id="registration-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@pingidentity.com" required />
          </div>
          <div className="hosted-registration__field-row">
            <div className="hosted-registration__field">
              <label htmlFor="registration-first-name">First name</label>
              <input className="hosted-registration__input" id="registration-first-name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required />
            </div>
            <div className="hosted-registration__field">
              <label htmlFor="registration-last-name">Last name</label>
              <input className="hosted-registration__input" id="registration-last-name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required />
            </div>
          </div>
          <div className="hosted-registration__field-row hosted-registration__field-row--phone">
            <div className="hosted-registration__field hosted-registration__field--country">
              <label htmlFor="registration-country-code">Country code</label>
              <input className="hosted-registration__input" id="registration-country-code" type="tel" value={form.countryCode} onChange={(event) => setForm({ ...form, countryCode: event.target.value })} placeholder="+1" autoComplete="tel-country-code" required />
            </div>
            <div className="hosted-registration__field">
              <label htmlFor="registration-phone">Cell phone</label>
              <input className="hosted-registration__input" id="registration-phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="214 555 0123" autoComplete="tel-national" required />
            </div>
          </div>
          <button className="hosted-registration__submit" type="submit">Send verification code</button>
        </form>
      )}
      {error && <p className="hosted-registration__error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
