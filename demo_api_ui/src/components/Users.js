import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import bffAxios from '../services/bffAxios';
import { notifySuccess, notifyError } from '../utils/appToast';
import { toastAdminSessionError } from '../utils/dashboardToast';
import { navigateToAdminOAuthLogin } from '../utils/authUi';
import { resolveSessionUser } from '../services/sessionResolver';
import AdminSubPageShell from './AdminSubPageShell';
import PageNav from './PageNav';
import CreateUserPanel from './CreateUserPanel';
import { useSortableTable, SortableTh, latestUpdate, dateOf } from '../hooks/useSortableTable';

const USER_SORT_ACCESSORS = {
  updated: latestUpdate,
  name: (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim(),
  username: (u) => u.username,
  email: (u) => u.email,
  role: (u) => u.role,
  status: (u) => (u.isActive ? 1 : 0),
  created: dateOf('createdAt'),
};

const Users = ({ user, onLogout }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [agentRestrictionsUpdating, setAgentRestrictionsUpdating] = useState({});
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const sort = useSortableTable(users, USER_SORT_ACCESSORS, 'updated');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const sessionUser = await resolveSessionUser();
      if (!sessionUser) {
        toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
        return;
      }
      const response = await bffAxios.get('/api/users');
      setUsers(response.data.users);
    } catch (error) {
      console.error('Users error:', error);
      
      if (error.response?.status === 401) {
        toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
      } else if (error.response?.status === 403) {
        notifyError('You do not have permission to view users.');
      } else {
        notifyError('Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      fetchUsers();
      return;
    }

    try {
      setLoading(true);
      const sessionUser = await resolveSessionUser();
      if (!sessionUser) {
        toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
        return;
      }
      const response = await bffAxios.get(`/api/users/search/${searchQuery}`);
      setUsers(response.data.users);
    } catch (error) {
      console.error('Search error:', error);
      
      if (error.response?.status === 401) {
        toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
      } else if (error.response?.status === 403) {
        notifyError('You do not have permission to search users.');
      } else {
        notifyError('Failed to search users');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId, currentStatus) => {
    try {
      const sessionUser = await resolveSessionUser();
      if (!sessionUser) {
        toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
        return;
      }
      await bffAxios.put(`/api/users/${userId}`, {
        isActive: !currentStatus
      });
      notifySuccess(`User ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      fetchUsers(); // Refresh the list
    } catch (error) {
      console.error('Toggle status error:', error);
      
      if (error.response?.status === 401) {
        toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
      } else if (error.response?.status === 403) {
        notifyError('You do not have permission to update user status.');
      } else {
        notifyError('Failed to update user status');
      }
    }
  };

  const updateAgentRestrictions = async (userId, value) => {
    setAgentRestrictionsUpdating((prev) => ({ ...prev, [userId]: true }));
    try {
      await bffAxios.patch(`/api/admin/management/users/${userId}/agent-restrictions`, {
        agentRestrictions: value,
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, agentRestrictions: value } : u))
      );
    } catch (err) {
      console.error('Failed to update agentRestrictions:', err);
      notifyError('Failed to update agent restrictions');
    } finally {
      setAgentRestrictionsUpdating((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const deleteUser = async (userId, userName) => {
    if (!window.confirm(`Are you sure you want to delete user "${userName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const sessionUser = await resolveSessionUser();
      if (!sessionUser) {
        toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
        return;
      }
      await bffAxios.delete(`/api/users/${userId}`);
      notifySuccess(`User "${userName}" deleted successfully`);
      fetchUsers(); // Refresh the list
    } catch (error) {
      console.error('Delete user error:', error);
      
      if (error.response?.status === 401) {
        toastAdminSessionError('Your session has expired. Please sign in again.', navigateToAdminOAuthLogin);
      } else if (error.response?.status === 403) {
        notifyError('You do not have permission to delete users.');
      } else {
        const errorMessage = error.response?.data?.error || 'Failed to delete user';
        notifyError(errorMessage);
      }
    }
  };

  if (loading && users.length === 0) {
    return (
      <AdminSubPageShell title="Users" lead="Search and manage user accounts.">
        <div className="loading">
          <div>Loading users...</div>
        </div>
      </AdminSubPageShell>
    );
  }

  return (
    <AdminSubPageShell title="Users" lead="Search and manage user accounts.">
      <PageNav user={user} onLogout={onLogout} title="Users" />
      <div className="app-page-toolbar app-page-toolbar--start">
        <input
          type="text"
          className="form-input"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '200px' }}
        />
        <button type="button" onClick={handleSearch} className="btn btn-primary">
          Search
        </button>
      </div>

      <div className="app-page-card">
        <div className="card-header">
          <h2 className="card-title">User Management</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem' }}>
              {users.length} users found
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowCreatePanel(true)}
            >
              + Create Demo User
            </button>
          </div>
        </div>

        {showCreatePanel && (
          <CreateUserPanel
            onClose={() => setShowCreatePanel(false)}
            onCreated={() => { fetchUsers(); }}
          />
        )}

        {users.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <SortableTh columnKey="name" label="Name" sort={sort} />
                  <SortableTh columnKey="username" label="Username" sort={sort} />
                  <SortableTh columnKey="email" label="Email" sort={sort} />
                  <SortableTh columnKey="role" label="Role" sort={sort} />
                  <SortableTh columnKey="status" label="Status" sort={sort} />
                  <SortableTh columnKey="created" label="Created" sort={sort} />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sort.sortedRows.map((user) => (
                  <tr key={user.id}>
                    <td>{user.firstName} {user.lastName}</td>
                    <td>{user.username}</td>
                    <td>{user.email}</td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: user.role === 'admin' ? '#ef4444' : '#10b981',
                        color: 'white'
                      }}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        backgroundColor: user.isActive ? '#10b981' : '#6b7280',
                        color: 'white'
                      }}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{format(new Date(user.createdAt), 'MMM dd, yyyy')}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Agent access:</label>
                          <select
                            value={user.agentRestrictions || 'write'}
                            disabled={agentRestrictionsUpdating[user.id]}
                            onChange={(e) => updateAgentRestrictions(user.id, e.target.value)}
                            style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.3rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--surface-bg)',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                            }}
                          >
                            <option value="write">write (full)</option>
                            <option value="read">read only</option>
                            <option value="none">none (blocked)</option>
                          </select>
                          {agentRestrictionsUpdating[user.id] && (
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>saving...</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => toggleUserStatus(user.id, user.isActive)}
                            className={`btn ${user.isActive ? 'btn-danger' : 'btn-success'}`}
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                          >
                            {user.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => deleteUser(user.id, `${user.firstName} ${user.lastName}`)}
                            className="btn btn-danger"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                            title="Delete user"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No users found</h3>
            <p>No users match the current search criteria.</p>
          </div>
        )}
      </div>
    </AdminSubPageShell>
  );
};

export default Users;
