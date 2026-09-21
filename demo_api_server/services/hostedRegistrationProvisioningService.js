'use strict';

const { managementService } = require('./pingoneManagementService');
const pingOneClientService = require('./pingOneClientService');

async function ensureManagement() {
  const token = await pingOneClientService.getManagementToken();
  managementService.initialize(token);
  return managementService;
}

function createHostedRegistrationProvisioningService({ management = null } = {}) {
  async function approve(record, { groupId } = {}) {
    const service = management || await ensureManagement();
    let user = record.pingOneUserId ? await service.getUser(record.pingOneUserId) : null;
    if (user?.success === false) {
      throw Object.assign(new Error(user.error || 'PingOne user lookup failed'), { code: 'pingone_lookup_failed' });
    }
    if (!user) {
      const created = await service.createUser({
        populationId: process.env.HOSTED_ACCESS_POPULATION_ID,
        username: record.email,
        email: record.email,
        firstName: record.firstName,
        lastName: record.lastName,
        canAuthenticate: false,
      });
      if (!created.success) throw Object.assign(new Error(created.error || 'PingOne user creation failed'), { code: 'pingone_provision_failed' });
      user = created.user;
    }
    if (groupId) {
      const added = await service.addUserToGroup(user.id, groupId);
      if (!added.success) throw Object.assign(new Error(added.error || 'PingOne group assignment failed'), { code: 'pingone_group_failed' });
    }
    const enabled = await service.setUserCanAuthenticate(user.id, true);
    if (!enabled.success) throw Object.assign(new Error(enabled.error || 'PingOne user enable failed'), { code: 'pingone_enable_failed' });
    return { pingOneUserId: user.id, groups: groupId ? [groupId] : [] };
  }

  async function disable(record) {
    if (!record.pingOneUserId) return { success: true };
    const service = management || await ensureManagement();
    return service.setUserCanAuthenticate(record.pingOneUserId, false);
  }

  async function reject(record) {
    if (!record.pingOneUserId) return { success: true };
    return disable(record);
  }

  return { approve, disable, reject };
}

module.exports = { createHostedRegistrationProvisioningService };
