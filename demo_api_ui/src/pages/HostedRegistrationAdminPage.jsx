import { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';

export default function HostedRegistrationAdminPage() {
  const [registrations, setRegistrations] = useState([]);
  const [error, setError] = useState('');

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
    </main>
  );
}
