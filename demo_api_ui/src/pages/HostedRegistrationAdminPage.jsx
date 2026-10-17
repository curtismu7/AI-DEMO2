import { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import * as hostedFlow from '../config/hostedAccessDiagram';

const HOSTED_FLOW = { GROUPS: hostedFlow.HOSTED_ACCESS_GROUPS, NODES: hostedFlow.HOSTED_ACCESS_NODES, EDGES: hostedFlow.HOSTED_ACCESS_EDGES, STEPS: hostedFlow.HOSTED_ACCESS_STEPS };

export default function HostedRegistrationAdminPage() {
  const [registrations, setRegistrations] = useState([]);
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteState, setInviteState] = useState(null); // {ok, message}

  async function sendInvite(e) {
    e.preventDefault();
    setInviteState(null);
    setInviteSending(true);
    try {
      const response = await apiClient.post('/api/demo/send-invite', { email: inviteEmail });
      const native = response.data.nativeEmail === 'sent'
        ? ' A "set your password" email was also sent.'
        : response.data.nativeEmail === 'failed'
          ? ' A "set your password" email could not be sent — the invitee can still register at the link.'
          : '';
      setInviteState({ ok: true, message: `Invite ready — registration link (send it to the invitee): ${response.data.registrationUrl}.${native}` });
      setInviteEmail('');
    } catch (err) {
      setInviteState({ ok: false, message: err.response?.data?.message || 'Invite failed.' });
    } finally {
      setInviteSending(false);
    }
  }

  async function load() {
    try {
      const response = await apiClient.get('/api/admin/hosted-registrations');
      setRegistrations(response.data.registrations || []);
    } catch (_) {
      setError('Could not load hosted registration requests.');
    }
  }

  useEffect(() => { load(); }, []);

  async function approve(registration) {
    await apiClient.post(`/api/admin/hosted-registrations/${registration.id}/approve`, { role: registration.requestedRole || 'user' });
    await load();
  }

  async function disable(registration) {
    await apiClient.post(`/api/admin/hosted-registrations/${registration.id}/disable`);
    await load();
  }

  async function reject(registration) {
    await apiClient.post(`/api/admin/hosted-registrations/${registration.id}/reject`);
    await load();
  }

  return (
    <main style={{ padding: '2rem' }}>
      <h1>Hosted registration requests</h1>
      {error && <p role="alert">{error}</p>}
      <section style={{ marginBottom: '2rem' }}>
        <h2>Invite a user</h2>
        <form onSubmit={sendInvite} style={{ display: 'flex', gap: '0.5rem', maxWidth: '32rem' }}>
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@pingidentity.com"
            style={{ flex: 1, padding: '0.4rem' }}
          />
          <button type="submit" disabled={inviteSending}>{inviteSending ? 'Sending…' : 'Send invite'}</button>
        </form>
        {inviteState && <p role="status" style={{ color: inviteState.ok ? 'green' : 'crimson' }}>{inviteState.message}</p>}
        <p style={{ fontSize: '0.85rem', color: '#555' }}>
          The invitee registers at <code>/welcome?welcome=1</code> — their account is created up front; they sign in and set a new password there.
        </p>
      </section>
      <table>
        <thead><tr><th>Email</th><th>Status</th><th>Requested role</th><th>Actions</th></tr></thead>
        <tbody>
          {registrations.map((registration) => (
            <tr key={registration.id}>
              <td>{registration.email}</td>
              <td>{registration.status}</td>
              <td>{registration.requestedRole}</td>
              <td>
                {['pending_approval', 'disabled'].includes(registration.status) && <button type="button" onClick={() => approve(registration)}>{registration.status === 'disabled' ? 'Enable' : 'Approve'}</button>}
                {registration.status === 'pending_approval' && <button type="button" onClick={() => reject(registration)}>Reject</button>}
                {registration.status === 'approved' && <button type="button" onClick={() => disable(registration)}>Disable</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <EmbeddedFlowDiagram config={HOSTED_FLOW} testId="hosted-flow" ariaLabel="Hosted access registration flow"
        title="Hosted access: request, invite, approval"
        lede="Requesters verify an email code, admins can also invite directly, and an admin approval moves the user into the group that opens the hosted-access wall." />
    </main>
  );
}
