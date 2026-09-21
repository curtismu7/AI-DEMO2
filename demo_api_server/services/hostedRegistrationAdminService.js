'use strict';

const defaultStore = require('./lmdb/hostedRegistrationStore.lmdb');
const { createHostedRegistrationProvisioningService } = require('./hostedRegistrationProvisioningService');

const ROLE_GROUP_ENV = Object.freeze({
  user: 'HOSTED_ACCESS_USER_GROUP_ID',
  admin: 'HOSTED_ACCESS_ADMIN_GROUP_ID',
});

function createHostedRegistrationAdminService({
  store = defaultStore,
  provisioner = createHostedRegistrationProvisioningService(),
  now = Date.now,
} = {}) {
  function get(id) {
    const record = store.get(id);
    if (!record) throw Object.assign(new Error('Registration not found'), { code: 'registration_not_found' });
    return record;
  }

  async function approve(id, { role = 'user', adminId = null } = {}) {
    if (!ROLE_GROUP_ENV[role]) throw Object.assign(new Error('Invalid hosted registration role'), { code: 'invalid_role' });
    const record = get(id);
    if (!['pending_approval', 'disabled'].includes(record.status)) {
      if (record.status === 'approved') return { ...record };
      throw Object.assign(new Error('Registration is not awaiting approval'), { code: 'invalid_registration_state' });
    }
    const groupId = process.env[ROLE_GROUP_ENV[role]] || '';
    const provisioned = await provisioner.approve(record, { role, groupId });
    const updated = {
      ...record,
      status: 'approved',
      requestedRole: role,
      groups: provisioned.groups || (groupId ? [groupId] : []),
      pingOneUserId: provisioned.pingOneUserId || record.pingOneUserId,
      approvedAt: record.approvedAt || now(),
      approvedBy: record.approvedBy || adminId,
      updatedAt: now(),
    };
    store.put(updated);
    return updated;
  }

  async function reject(id, { adminId = null } = {}) {
    const record = get(id);
    if (record.status === 'rejected') return record;
    const updated = { ...record, status: 'rejected', rejectedAt: record.rejectedAt || now(), rejectedBy: record.rejectedBy || adminId, updatedAt: now() };
    await provisioner.reject(record);
    store.put(updated);
    return updated;
  }

  async function disable(id, { adminId = null } = {}) {
    const record = get(id);
    await provisioner.disable(record);
    const updated = { ...record, status: 'disabled', disabledAt: now(), disabledBy: adminId, updatedAt: now() };
    store.put(updated);
    return updated;
  }

  return {
    list: ({ status } = {}) => store.list().filter((record) => !status || record.status === status),
    approve,
    reject,
    disable,
  };
}

module.exports = { ROLE_GROUP_ENV, createHostedRegistrationAdminService };
