'use strict';

const { managementService } = require('./pingoneManagementService');
const pingOneClientService = require('./pingOneClientService');
const mfaService = require('./mfaService');

async function ensureManagement() {
  const token = await pingOneClientService.getManagementToken();
  managementService.initialize(token);
  return managementService;
}

// The invite flow (send-invite) parks the invitee in the PARTIAL group before
// any self-registration happens; when the same email later self-registers,
// stage() re-runs against the SAME PingOne user and addUserToGroup reports
// the duplicate. That is success — the member is where stage() wants them.
function isAlreadyMemberOutcome(outcome) {
  const message = outcome?.error || outcome?.message || '';
  return outcome?.status === 409 || /already (a member|exists in|belongs to)/i.test(message);
}

function createHostedRegistrationProvisioningService({ management = null, enrollSmsDevice = management?.enrollSmsDevice || mfaService.enrollSmsDevice } = {}) {
  async function stage(record, { partialGroupId = process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID } = {}) {
    const service = management || await ensureManagement();
    let user = record.pingOneUserId ? await service.getUser(record.pingOneUserId) : null;
    if (user?.success === false) {
      throw Object.assign(new Error(user.error || 'PingOne user lookup failed'), { code: 'pingone_lookup_failed' });
    }
    if (!user && service.findUserByEmail) {
      user = await service.findUserByEmail(record.email);
      if (user?.success === false) {
        throw Object.assign(new Error(user.error || 'PingOne user lookup failed'), { code: 'pingone_lookup_failed' });
      }
    }
    if (!user) {
      const created = await service.createUser({
        populationId: process.env.HOSTED_ACCESS_POPULATION_ID,
        username: record.email,
        email: record.email,
        firstName: record.firstName,
        lastName: record.lastName,
        mobilePhone: record.phone,
        mfaEnabled: true,
        canAuthenticate: false,
      });
      if (!created.success) throw Object.assign(new Error(created.error || 'PingOne user creation failed'), { code: 'pingone_provision_failed' });
      user = created.user;
    }
    if (service.setUserMfaEnabled) {
      const mfaEnabled = await service.setUserMfaEnabled(user.id, true);
      if (!mfaEnabled.success) throw Object.assign(new Error(mfaEnabled.error || 'PingOne MFA enable failed'), { code: 'pingone_mfa_failed' });
    }
    if (partialGroupId) {
      let added;
      try {
        added = await service.addUserToGroup(user.id, partialGroupId);
      } catch (err) {
        if (!isAlreadyMemberOutcome(err)) throw err;
        added = { success: true, alreadyMember: true };
      }
      if (!added.success && !isAlreadyMemberOutcome(added)) {
        throw Object.assign(new Error(added.error || 'PingOne partial group assignment failed'), { code: 'pingone_group_failed' });
      }
    }
    return { pingOneUserId: user.id, groups: partialGroupId ? [partialGroupId] : [] };
  }

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
        mobilePhone: record.phone,
        canAuthenticate: false,
      });
      if (!created.success) throw Object.assign(new Error(created.error || 'PingOne user creation failed'), { code: 'pingone_provision_failed' });
      user = created.user;
    }
    if (service.updateUserProfile) {
      const updated = await service.updateUserProfile(user.id, {
        firstName: record.firstName,
        lastName: record.lastName,
        mobilePhone: record.phone,
      });
      if (!updated.success) throw Object.assign(new Error(updated.error || 'PingOne profile update failed'), { code: 'pingone_profile_failed' });
    }
    let smsDeviceId = null;
    if (record.phone && enrollSmsDevice) {
      const device = await enrollSmsDevice(user.id, record.phone);
      if (!device?.id) throw Object.assign(new Error('PingOne SMS MFA device enrollment failed'), { code: 'pingone_sms_mfa_failed' });
      smsDeviceId = device.id;
    }
    if (groupId) {
      const added = await service.addUserToGroup(user.id, groupId);
      if (!added.success) throw Object.assign(new Error(added.error || 'PingOne group assignment failed'), { code: 'pingone_group_failed' });
    }
    const partialGroupId = process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID;
    if (partialGroupId && partialGroupId !== groupId) {
      const removed = await service.removeUserFromGroup(user.id, partialGroupId);
      if (!removed.success) throw Object.assign(new Error(removed.error || 'PingOne partial group removal failed'), { code: 'pingone_group_failed' });
    }
    const enabled = await service.setUserCanAuthenticate(user.id, true);
    if (!enabled.success) throw Object.assign(new Error(enabled.error || 'PingOne user enable failed'), { code: 'pingone_enable_failed' });
    return { pingOneUserId: user.id, groups: groupId ? [groupId] : [], smsDeviceId };
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

  return { stage, approve, disable, reject };
}

module.exports = { createHostedRegistrationProvisioningService };
