module.exports = jest.fn(() => ({ use: jest.fn() }));
module.exports.Router = jest.fn(() => ({ get: jest.fn(), patch: jest.fn() }));
