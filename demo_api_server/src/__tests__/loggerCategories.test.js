'use strict';

// The hosted-access deny log and the send-invite pending-group warns log with
// LOG_CATEGORIES.USER_MANAGEMENT — the category must exist on the REAL logger
// module or the calls log with category undefined and become unfilterable.
const { LOG_CATEGORIES } = require('../../utils/logger');

describe('utils/logger LOG_CATEGORIES', () => {
  test('exposes USER_MANAGEMENT for hosted-access deny and invite group-add logs', () => {
    expect(LOG_CATEGORIES.USER_MANAGEMENT).toBe('user_management');
  });
});
